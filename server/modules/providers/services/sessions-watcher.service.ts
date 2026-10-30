import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import chokidar, { type FSWatcher } from 'chokidar';

import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';
import { broadcastSessionUpsertedBatch } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';

type WatcherEventType = 'add' | 'change';

type ProviderWatchPath = {
  provider: LLMProvider;
  rootPath: string;
  /**
   * Whether a missing root is created so the watcher can attach to it before
   * the provider ever writes there.
   *
   * True everywhere it is omitted, which is the historical behaviour: those
   * roots are cheap directories under a CLI's own dotfolder. A provider that
   * sets it to `false` is skipped entirely when its root is absent, so a
   * machine without that CLI installed pays nothing — no directory created
   * and no polling watcher attached.
   */
  createIfMissing?: boolean;
};

/**
 * Resolved on each call so the home directory is read when the watcher starts, not when this module loads.
 *
 * @internal Exported for the watcher tests, which pin which paths each provider
 * watches and which files under them are synchronization triggers. Reaching the
 * antigravity branch any other way would mean installing `agy`.
 */
export function getProviderWatchPaths(): ProviderWatchPath[] {
  const homeDir = os.homedir();

  return [
    {
      provider: 'claude',
      rootPath: path.join(homeDir, '.claude', 'projects'),
    },
    {
      provider: 'cursor',
      rootPath: path.join(homeDir, '.cursor', 'projects'),
    },
    {
      provider: 'codex',
      rootPath: path.join(homeDir, '.codex', 'sessions'),
    },
    {
      provider: 'opencode',
      rootPath: path.join(homeDir, '.local', 'share', 'opencode'),
    },
    {
      // `brain/` only, not the whole `antigravity-cli` app data directory. The
      // transcript under it is the artifact that grows as a turn advances, and
      // synchronizing one re-reads that conversation's row in the shared index
      // anyway — so watching the index file as well would buy nothing and cost
      // a polling watcher on a WAL sqlite database the Antigravity IDE writes.
      provider: 'antigravity',
      rootPath: path.join(homeDir, '.gemini', 'antigravity-cli', 'brain'),
      createIfMissing: false,
    },
    {
      // A rename writes here and nowhere under `brain/`, and the index's
      // `last_modified_time` does not move with it. One flat directory of tiny
      // files, so a second polling watcher costs next to nothing.
      provider: 'antigravity',
      rootPath: path.join(homeDir, '.gemini', 'antigravity-cli', 'annotations'),
      createIfMissing: false,
    },
  ];
}

/**
 * What the watcher never descends into or reports. These used to be glob
 * strings, which chokidar v4 no longer understands: it takes a path, a RegExp
 * or a function, so the globs matched nothing and every file under every
 * provider root was watched and, with polling, stat()ed every interval (#1156).
 */
const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  // Claude writes a subagent's transcript and large tool outputs here. The
  // synchronizer skips them already (#880); ignoring them here keeps the
  // watcher from walking them at all.
  'subagents',
  'tool-results',
]);
const IGNORED_FILE_NAMES = new Set(['.DS_Store']);
const IGNORED_FILE_SUFFIXES = ['.tmp', '.swp'];

/**
 * Builds chokidar's `ignored` matcher for one watch root.
 *
 * Only the part of the path below `rootPath` is checked, so a home directory
 * that happens to sit under `/build` or `/dist` cannot hide a whole provider.
 *
 * Exported for the providers module's tests, which run it against chokidar on
 * a real directory tree.
 */
export function createWatcherIgnoredMatcher(rootPath: string): (filePath: string) => boolean {
  return (filePath: string) => {
    const relativePath = path.relative(rootPath, filePath);
    // Outside the root is `..` as a whole component, or an absolute result
    // (another drive on Windows). A child called `..archive` is still inside.
    const isOutsideRoot = relativePath === '..'
      || relativePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativePath);
    if (!relativePath || isOutsideRoot) {
      return false;
    }

    const segments = relativePath.split(path.sep);
    const baseName = segments[segments.length - 1];
    if (IGNORED_FILE_NAMES.has(baseName) || IGNORED_FILE_SUFFIXES.some((suffix) => baseName.endsWith(suffix))) {
      return true;
    }

    // Antigravity mirrors both transcripts into 100 KiB chunks under
    // `…/logs/chunks/transcript{,_full}/NNNNNNNN.jsonl`. They are `.jsonl`, they
    // are rewritten on every append, and they carry nothing the top-level
    // transcript does not — the top-level file is byte-exactly their
    // concatenation — so a busy conversation would otherwise fire an event per
    // chunk per step.
    return segments.some((segment, index) => (
      IGNORED_DIRECTORY_NAMES.has(segment) || (segment === 'logs' && segments[index + 1] === 'chunks')
    ));
  };
}

const PROJECTS_UPDATE_DEBOUNCE_MS = 500;
const PROJECTS_UPDATE_MAX_WAIT_MS = 2_000;

const watchers: FSWatcher[] = [];

type PendingWatcherUpdate = {
  providers: Set<LLMProvider>;
  changeTypes: Set<WatcherEventType>;
  /**
   * Provider-native session ids reported by the synchronizers. They are
   * translated back to app-facing session rows at flush time, because the
   * transcript file names on disk only ever contain provider ids.
   */
  updatedSessionIds: Set<string>;
};

let pendingWatcherUpdate: PendingWatcherUpdate | null = null;
let pendingWatcherUpdateStartedAt: number | null = null;
let pendingWatcherFlushTimer: ReturnType<typeof setTimeout> | null = null;
let watcherRefreshInFlight = false;
let watcherRescheduleAfterRefresh = false;

/**
 * Filters watcher events to provider-specific session artifact file types.
 *
 * @internal Exported for the watcher tests.
 */
export function isWatcherTargetFile(provider: LLMProvider, filePath: string): boolean {
  if (provider === 'opencode') {
    return path.basename(filePath) === 'opencode.db';
  }

  if (provider === 'antigravity') {
    // Named rather than suffixed, because the tree under `brain/` holds three
    // kinds of `.jsonl`: the transcript, the untruncated `transcript_full.jsonl`
    // beside it, and the chunk mirrors. Only the first one is a synchronization
    // trigger — the other two are rewritten in lockstep with it and would each
    // repeat the same work. This is also the second line of defence for the
    // chunks, which the ignore pattern already keeps out.
    //
    // The one other trigger is a conversation's title file under
    // `annotations/`; the synchronizer rejects any other `.pbtxt` by path.
    return path.basename(filePath) === 'transcript.jsonl'
      || (filePath.endsWith('.pbtxt') && path.basename(path.dirname(filePath)) === 'annotations');
  }

  return filePath.endsWith('.jsonl');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function clearPendingWatcherFlushTimer(): void {
  if (pendingWatcherFlushTimer) {
    clearTimeout(pendingWatcherFlushTimer);
    pendingWatcherFlushTimer = null;
  }
}

function schedulePendingWatcherFlush(): void {
  if (!pendingWatcherUpdate) {
    return;
  }

  const now = Date.now();
  if (pendingWatcherUpdateStartedAt === null) {
    pendingWatcherUpdateStartedAt = now;
  }

  const elapsed = now - pendingWatcherUpdateStartedAt;
  const remainingMaxWait = Math.max(0, PROJECTS_UPDATE_MAX_WAIT_MS - elapsed);
  const delay = Math.min(PROJECTS_UPDATE_DEBOUNCE_MS, remainingMaxWait);

  clearPendingWatcherFlushTimer();
  pendingWatcherFlushTimer = setTimeout(() => {
    void flushPendingWatcherUpdate();
  }, delay);
}

function queuePendingWatcherUpdate(
  eventType: WatcherEventType,
  provider: LLMProvider,
  updatedSessionId: string | null
): void {
  if (!pendingWatcherUpdate) {
    pendingWatcherUpdate = {
      providers: new Set<LLMProvider>(),
      changeTypes: new Set<WatcherEventType>(),
      updatedSessionIds: new Set<string>(),
    };
  }

  pendingWatcherUpdate.providers.add(provider);
  pendingWatcherUpdate.changeTypes.add(eventType);
  if (updatedSessionId) {
    pendingWatcherUpdate.updatedSessionIds.add(updatedSessionId);
  }

  schedulePendingWatcherFlush();
}

async function flushPendingWatcherUpdate(): Promise<void> {
  clearPendingWatcherFlushTimer();

  if (!pendingWatcherUpdate) {
    return;
  }

  if (watcherRefreshInFlight) {
    watcherRescheduleAfterRefresh = true;
    return;
  }

  const queuedUpdate = pendingWatcherUpdate;
  pendingWatcherUpdate = null;
  pendingWatcherUpdateStartedAt = null;
  watcherRefreshInFlight = true;

  try {
    // Per-session deltas instead of full project snapshots: an upsert of one
    // session can never clobber unrelated client state, so the frontend needs
    // no "suppress updates while a run is active" protection logic.
    await broadcastSessionUpsertedBatch(queuedUpdate.updatedSessionIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Session watcher refresh failed while broadcasting session_upserted', { error: message });
  } finally {
    watcherRefreshInFlight = false;

    if (pendingWatcherUpdate || watcherRescheduleAfterRefresh) {
      watcherRescheduleAfterRefresh = false;
      schedulePendingWatcherFlush();
    }
  }
}

/**
 * Handles file watcher updates and triggers provider file-level synchronization.
 *
 * @internal Exported for the watcher tests.
 */
export async function onUpdate(
  eventType: WatcherEventType,
  filePath: string,
  provider: LLMProvider
): Promise<void> {
  if (!isWatcherTargetFile(provider, filePath)) {
    return;
  }

  try {
    const result = await sessionSynchronizerService.synchronizeProviderFile(provider, filePath);
    if (!result.indexed) {
      return;
    }

    console.log(`Session synchronization triggered by ${eventType} event for provider "${provider}"`, {
      filePath,
      sessionId: result.sessionId,
    });
    queuePendingWatcherUpdate(eventType, provider, result.sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Session watcher sync failed for provider "${provider}"`, {
      eventType,
      filePath,
      error: message,
    });
  }
}

/**
 * Starts provider filesystem watchers and performs initial DB synchronization.
 */
export async function initializeSessionsWatcher(): Promise<void> {
  console.log('Setting up session watchers');

  const initialSync = await sessionSynchronizerService.synchronizeSessions();
  console.log('Initial session synchronization complete', {
    processedByProvider: initialSync.processedByProvider,
    prunedOrphans: initialSync.prunedOrphans,
    failures: initialSync.failures,
  });

  for (const { provider, rootPath, createIfMissing = true } of getProviderWatchPaths()) {
    try {
      if (createIfMissing) {
        await fsPromises.mkdir(rootPath, { recursive: true });
      } else if (!await pathExists(rootPath)) {
        // Nothing to watch and nothing to create: the CLI is not installed, or
        // has never been run on this machine.
        continue;
      }

      const watcher = chokidar.watch(rootPath, {
        ignored: createWatcherIgnoredMatcher(rootPath),
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        depth: 6,
        // Polling reaches filesystems that native events cannot: WSL's /mnt/c,
        // network shares, some container mounts. Where native events do work,
        // chokidar's own CHOKIDAR_USEPOLLING=false overrides this and a finished
        // turn reaches the sidebar at once instead of up to 6 s later.
        usePolling: true,
        interval: 6_000,
        binaryInterval: 6_000,
      });

      watcher
        .on('add', (filePath: string) => {
          void onUpdate('add', filePath, provider);
        })
        .on('change', (filePath: string) => {
          void onUpdate('change', filePath, provider);
        })
        .on('error', (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Session watcher error for provider "${provider}"`, { error: message });
        });

      watchers.push(watcher);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to initialize session watcher for provider "${provider}"`, {
        rootPath,
        error: message,
      });
    }
  }
}

/**
 * Stops all active provider session watchers.
 */
export async function closeSessionsWatcher(): Promise<void> {
  clearPendingWatcherFlushTimer();

  await Promise.all(
    watchers.map(async (watcher) => {
      try {
        await watcher.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Failed to close session watcher', { error: message });
      }
    })
  );
  watchers.length = 0;
  pendingWatcherUpdate = null;
  pendingWatcherUpdateStartedAt = null;
  watcherRefreshInFlight = false;
  watcherRescheduleAfterRefresh = false;
}
