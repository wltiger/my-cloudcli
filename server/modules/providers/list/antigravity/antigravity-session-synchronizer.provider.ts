/**
 * Antigravity (`agy`) session indexer
 * ===================================
 *
 * The list view comes from `~/.gemini/antigravity-cli/conversation_summaries.db`,
 * the conversation index `agy` shares with the Antigravity IDE. It is opened
 * **read-only and never recorded as a session's transcript path**: it is the
 * IDE's own sidebar state, and a session row that pointed at it would let
 * deleting one CloudCLI session delete every Antigravity conversation on the
 * machine. This is the same shape the OpenCode synchronizer uses for its shared
 * `opencode.db`.
 *
 * Column semantics are documented in
 * `docs/agents/antigravity-provider-implementation.md` §4-5.
 */

import fsSync from 'node:fs';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import {
  normalizeProviderTimestamp,
  normalizeSessionName,
  readJsonRecord,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

import {
  ANTIGRAVITY_CLI_APP_DATA_DIR,
  getAntigravityAppDataDir,
  listAnnotatedConversationIdsSince,
  openAntigravitySummariesDatabase,
  readAntigravityAnnotationTitle,
  readConversationIdFromAnnotationPath,
  readConversationIdFromTranscriptPath,
} from './antigravity-sessions.provider.js';

const FALLBACK_TITLE = 'Untitled Antigravity Session';

type AntigravitySummaryRow = {
  conversation_id: string | null;
  title: string | null;
  preview: string | null;
  last_modified_time: string | null;
  workspace_uris: string | null;
  project_id: string | null;
  /** `agy`'s own "this conversation is still working" flag. */
  not_fully_idle: number | null;
  /** Set once a conversation was terminated; a killed run is never live. */
  killed: number | null;
};

/**
 * Every conversation the CLI owns, newest first.
 *
 * `app_data_dir` is what separates them from the IDE's own rows in the shared
 * index. Nested runs are excluded: a subagent conversation is part of its
 * parent's turn, not a session of its own, and listing it would put rows in the
 * sidebar the user never started.
 */
const SUMMARY_ROWS_SQL = `
  SELECT
    conversation_id,
    title,
    preview,
    last_modified_time,
    workspace_uris,
    project_id,
    not_fully_idle,
    killed
  FROM conversation_summaries
  WHERE app_data_dir = ?
    AND nesting_depth = 0
    AND parent_conversation_id = ''
`;

/**
 * Converts a `file://` URI from `agy`'s own records into a filesystem path.
 *
 * Both encodings `agy` writes are handled: `file:///C:/code/foo` and the
 * double-encoded `file:///c%253A/code/foo` it also emits for the same
 * directory, which survives one `decodeURIComponent` as `%3A`.
 */
const fileUriToPath = (uri: string): string | null => {
  if (!uri.startsWith('file://')) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(uri.slice('file://'.length));
  } catch {
    return null;
  }

  const windowsPath = /^\/([A-Za-z])(?::|%3A)(\/.*)$/i.exec(decoded);
  if (windowsPath) {
    return `${windowsPath[1]}:${windowsPath[2]}`;
  }

  return decoded || null;
};

/** The first usable directory out of a JSON array of `file://` URIs. */
const readFirstWorkspacePath = (value: unknown): string | null => {
  const uris = typeof value === 'string' && value.trim() ? JSON.parse(value) : null;
  if (!Array.isArray(uris)) {
    return null;
  }

  for (const uri of uris) {
    const resolved = typeof uri === 'string' ? fileUriToPath(uri) : null;
    if (resolved) {
      return resolved;
    }
  }

  return null;
};

const readWorkspacePathFromUris = (value: unknown): string | null => {
  try {
    return readFirstWorkspacePath(value);
  } catch {
    return null;
  }
};

/**
 * The directory an Antigravity project record covers.
 *
 * `~/.gemini/config/projects/<project-id>.json` is the user's own project
 * record — the same one a permission grant is scoped to (ADR 0015) — and it is
 * how a conversation started in a terminal, with `--project` but without
 * `--add-dir`, still lands in the right CloudCLI project. Read-only; creating
 * or editing these records belongs to the permissions ticket.
 */
const readProjectRecordPath = (projectId: string): string | null => {
  if (!projectId || projectId !== path.basename(projectId) || projectId.includes('..')) {
    return null;
  }

  let raw: string;
  try {
    raw = fsSync.readFileSync(
      path.join(path.dirname(getAntigravityAppDataDir()), 'config', 'projects', `${projectId}.json`),
      'utf8',
    );
  } catch {
    return null;
  }

  const resources = readObjectRecord(readJsonRecord(raw)?.projectResources)?.resources;
  if (!Array.isArray(resources)) {
    return null;
  }

  for (const entry of resources) {
    const resource = readObjectRecord(entry);
    // Two shapes in the wild: a bare `{folderUri}` and a git-aware
    // `{gitFolder: {folderUri}}`.
    const uri = readOptionalString(resource?.folderUri)
      ?? readOptionalString(readObjectRecord(resource?.gitFolder)?.folderUri);
    const resolved = uri ? fileUriToPath(uri) : null;
    if (resolved) {
      return resolved;
    }
  }

  return null;
};

/**
 * `agy`'s own workspace -> newest-conversation cache, inverted.
 *
 * Last resort for a conversation started with neither `--add-dir` nor a
 * `--project` whose record names a folder: it only knows the most recent
 * conversation per workspace, which is exactly the one a user is most likely to
 * want back. Read once per scan.
 */
const readLastConversationWorkspaces = (): Map<string, string> => {
  const workspaces = new Map<string, string>();
  let raw: string;
  try {
    raw = fsSync.readFileSync(path.join(getAntigravityAppDataDir(), 'cache', 'last_conversations.json'), 'utf8');
  } catch {
    return workspaces;
  }

  const record = readJsonRecord(raw);
  for (const [workspacePath, conversationId] of Object.entries(record ?? {})) {
    if (typeof conversationId === 'string' && conversationId) {
      workspaces.set(conversationId, workspacePath);
    }
  }

  return workspaces;
};

/**
 * Session indexer for Antigravity's shared conversation index.
 */
export class AntigravitySessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'antigravity' as const;

  /**
   * Indexes every CLI conversation the shared index knows about.
   *
   * Runs on every sidebar refresh, so it is an upsert keyed on the conversation
   * id — running it twice changes nothing — and `since` keeps a rescan down to
   * the conversations that moved.
   */
  async synchronize(since?: Date): Promise<number> {
    return this.synchronizeRows(since).processed;
  }

  /**
   * Indexes the one conversation a watcher event points at.
   *
   * Accepts any artifact `agy` rewrites as a conversation advances: its own
   * transcript, its annotation file (the title), and the shared index.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    const conversationId = readConversationIdFromTranscriptPath(filePath)
      ?? readConversationIdFromAnnotationPath(filePath);
    if (conversationId) {
      return this.synchronizeRows(undefined, { conversationId }).firstSessionId;
    }

    if (path.basename(filePath) === 'conversation_summaries.db') {
      return this.synchronizeRows(undefined, { limit: 1 }).firstSessionId;
    }

    return null;
  }

  private synchronizeRows(
    since?: Date,
    options: { limit?: number; conversationId?: string } = {},
  ): { processed: number; firstSessionId: string | null } {
    const db = openAntigravitySummariesDatabase();
    if (!db) {
      return { processed: 0, firstSessionId: null };
    }

    try {
      const sinceMillis = since?.getTime() ?? null;
      // A rename moves the annotation file but not `last_modified_time`, so a
      // title written while CloudCLI was down is admitted by the file's mtime.
      const annotatedSince = sinceMillis === null
        ? new Set<string>()
        : listAnnotatedConversationIdsSince(sinceMillis);
      // `last_modified_time` is a SQLite datetime string (`2026-09-21
      // 03:49:45.368802+00:00`), so the incremental cursor is applied after
      // parsing rather than as a SQL comparison against an ISO timestamp.
      const rows = (db.prepare(SUMMARY_ROWS_SQL).all(ANTIGRAVITY_CLI_APP_DATA_DIR) as AntigravitySummaryRow[])
        .map((row) => ({ row, modifiedAt: Date.parse(row.last_modified_time ?? '') }))
        .filter(({ row, modifiedAt }) => {
          if (!readOptionalString(row.conversation_id)) {
            return false;
          }
          if (options.conversationId) {
            return row.conversation_id === options.conversationId;
          }
          return sinceMillis === null
            || !Number.isFinite(modifiedAt)
            || modifiedAt >= sinceMillis
            || annotatedSince.has(row.conversation_id as string);
        })
        .sort((left, right) => (right.modifiedAt || 0) - (left.modifiedAt || 0))
        .slice(0, options.limit ?? undefined);

      const lastConversationWorkspaces = rows.length > 0
        ? readLastConversationWorkspaces()
        : new Map<string, string>();
      let processed = 0;
      let firstSessionId: string | null = null;

      for (const { row } of rows) {
        const indexedSessionId = this.upsertSession(row, lastConversationWorkspaces);
        if (!indexedSessionId) {
          continue;
        }

        if (!firstSessionId) {
          firstSessionId = indexedSessionId;
        }
        processed += 1;
      }

      return { processed, firstSessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[AntigravityProvider] Failed to synchronize sessions:', message);
      return { processed: 0, firstSessionId: null };
    } finally {
      db.close();
    }
  }

  /**
   * Resolves which directory a conversation belongs to.
   *
   * `--add-dir` is what fills `workspace_uris`, and the runtime always passes
   * it, so a conversation CloudCLI started answers on the first source. The
   * rest recover conversations started in a terminal or in the IDE, through the
   * `--project` id the runtime also always passes: first as a CloudCLI project
   * id, then as an Antigravity project record. A conversation none of them
   * place is left unindexed rather than filed under a guessed directory.
   */
  private resolveProjectPath(row: AntigravitySummaryRow, lastConversationWorkspaces: Map<string, string>): string | null {
    const workspacePath = readWorkspacePathFromUris(row.workspace_uris);
    if (workspacePath) {
      return workspacePath;
    }

    const projectId = readOptionalString(row.project_id);
    if (projectId) {
      const cloudCliProjectPath = projectsDb.getProjectPathById(projectId);
      if (cloudCliProjectPath) {
        return cloudCliProjectPath;
      }

      const projectRecordPath = readProjectRecordPath(projectId);
      if (projectRecordPath) {
        return projectRecordPath;
      }
    }

    return lastConversationWorkspaces.get(row.conversation_id ?? '') ?? null;
  }

  /**
   * The app session row a conversation id maps to, under either id it can be
   * filed as: `provider_session_id` once the runtime has reported it back, and
   * the session id itself for a row the app created with it directly.
   */
  private findSessionForConversation(conversationId: string) {
    return sessionsDb.getSessionByProviderSessionId(conversationId)
      ?? sessionsDb.getSessionById(conversationId);
  }

  private upsertSession(
    row: AntigravitySummaryRow,
    lastConversationWorkspaces: Map<string, string>,
  ): string | null {
    const conversationId = readOptionalString(row.conversation_id);
    const projectPath = conversationId ? this.resolveProjectPath(row, lastConversationWorkspaces) : null;
    if (!conversationId || !projectPath) {
      return null;
    }

    const pendingAppSession = this.findSessionForConversation(conversationId)
      ?? sessionsDb.findLatestPendingAppSession(this.provider, projectPath);
    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      // The index can carry a conversation before the runtime has reported its
      // id back over the websocket. Binding it to the waiting app row first is
      // what keeps one conversation from briefly showing as two sidebar rows.
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, conversationId);
    }

    const existingSession = this.findSessionForConversation(conversationId);
    const existingName = existingSession?.custom_name;

    // `agy`'s annotation file is the title's source — `/rename` and CloudCLI's
    // own rename both land there — so it wins over any name already stored.
    const annotationTitle = readAntigravityAnnotationTitle(conversationId);

    let nextName: string | undefined;
    if (annotationTitle) {
      nextName = annotationTitle;
    } else if (existingName && existingName !== FALLBACK_TITLE) {
      nextName = existingName;
    } else {
      // `title` is empty for most headless runs — 1.2.5+ skips the
      // title-generating model call — and `preview` is the first user prompt.
      nextName = readOptionalString(row.title) ?? readOptionalString(row.preview);
    }

    // The index has no conversation-start column, and recovering one would mean
    // reading every transcript's first record on every scan, so both timestamps
    // come from `last_modified_time`. Only `updated_at` orders the sidebar.
    const modifiedAt = normalizeProviderTimestamp(row.last_modified_time);

    // `jsonl_path` stays null: the shared index is not this session's file, and
    // a session row that named it would make deleting one CloudCLI session
    // delete the Antigravity IDE's own state.
    const appSessionId = sessionsDb.createSession(
      conversationId,
      this.provider,
      projectPath,
      normalizeSessionName(nextName, FALLBACK_TITLE),
      modifiedAt,
      modifiedAt,
      null,
    );

    // The upsert keeps the stored name of a row CloudCLI itself created, so the
    // annotation title is applied explicitly. Compared normalized on both sides:
    // the rename route allows longer names than `normalizeSessionName` keeps,
    // and a raw comparison would rewrite the same name on every scan.
    if (appSessionId && annotationTitle && existingName) {
      const annotationName = normalizeSessionName(annotationTitle, FALLBACK_TITLE);
      if (normalizeSessionName(existingName, FALLBACK_TITLE) !== annotationName) {
        sessionsDb.updateSessionCustomName(appSessionId, annotationName);
      }
    }

    if (appSessionId) {
      // A conversation `agy` is working on right now is the one case CloudCLI
      // cannot learn from its own run registry — it was started in a terminal
      // or in the IDE, so no run of ours exists. `not_fully_idle` is the
      // index's own answer and costs nothing: it rides the row already read.
      //
      // The recorded instant is the conversation's own `last_modified_time`,
      // not the time of this scan, so an `agy` that died mid-turn (leaving the
      // flag set with nothing left to clear it) goes stale on its own instead
      // of being refreshed forever by the next scan.
      sessionsDb.setSessionExternalRunningAt(
        appSessionId,
        row.not_fully_idle && !row.killed ? modifiedAt : null,
      );
    }

    return appSessionId;
  }
}
