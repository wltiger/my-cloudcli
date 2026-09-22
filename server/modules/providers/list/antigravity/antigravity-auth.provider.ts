import { open, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import {
  probeAntigravityModelIds,
  readFreshAntigravityModelIds,
} from '@/modules/providers/list/antigravity/antigravity-models.provider.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

/** `agy` keeps its own state under `~/.gemini/antigravity-cli/`, next to the Gemini CLI's. */
const AGY_APP_DATA_DIR = path.join(os.homedir(), '.gemini', 'antigravity-cli');

/** Rolled per-day log files the CLI writes its own auth state into. */
const AGY_LOG_DIR = path.join(AGY_APP_DATA_DIR, 'log');

/**
 * How much of the newest log file to read for auth-state lines.
 *
 * The current sign-in state is the newest one, and a long-running CLI grows one
 * day's log well past this — so read the tail, not the whole file.
 */
const AGY_LOG_TAIL_BYTES = 256 * 1024;

/** Marker `agy`'s updater writes once the CLI has actually run on this machine. */
const AGY_UPDATE_STATUS_PATH = path.join(AGY_APP_DATA_DIR, 'updater', 'update_status.json');

/** Marker `agy`'s first-run onboarding writes when it completes. */
const AGY_ONBOARDING_PATH = path.join(AGY_APP_DATA_DIR, 'cache', 'onboarding.json');

/**
 * The one auth-state sentence `agy` prints into its own log when it has no
 * usable stored login. It is a statement *about* login state, not credential
 * material: no token, no email, no account identifier.
 */
const AGY_NOT_LOGGED_IN_LINE = 'You are not logged into Antigravity.';

/**
 * How long this facet will wait on its own `agy models` probe.
 *
 * Far below the probe's own 15 s timeout on purpose: the client polls auth
 * status, so a hung CLI would otherwise hold every poll for the full timeout.
 * The probe is left alone — its timer still kills the late child — and losing
 * this race simply reads as "no answer from the CLI".
 */
const AGY_AUTH_PROBE_DEADLINE_MS = 2_000;

/** Major version this provider's NDJSON mapping was written against. */
const AGY_KNOWN_MAJOR_VERSION = 1;

const AGY_CLI_NOT_INSTALLED = 'Antigravity CLI is not installed';
// There is no `agy login` subcommand — signing in happens through `/login`
// inside the interactive CLI — so every signed-out message has to say where to
// go instead of promising a button.
const AGY_NOT_SIGNED_IN = 'Not signed in. Run `agy` in a terminal and sign in there.';

/**
 * Reads `agy --version`, returning the raw stdout.
 *
 * `null` means the CLI is not reachable. An empty string means it ran and
 * printed nothing parseable, which is still "installed" — the same
 * probe-and-fall-back shape the other four providers use.
 */
const readAgyVersionOutput = (): string | null => {
  try {
    const result = spawnFunction.sync('agy', ['--version'], {
      stdio: 'ignore',
      timeout: 5000,
      encoding: 'utf8',
    });
    if (result.error || result.status !== 0) {
      return null;
    }
    return typeof result.stdout === 'string' ? result.stdout : '';
  } catch {
    return null;
  }
};

const parseAgyVersion = (rawVersion: string): string | null => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(rawVersion);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
};

/** Reads a small text file, returning null for anything unreadable. */
const readTextFile = async (filePath: string): Promise<string | null> => {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
};

/** The newest `cli-*.log` in agy's log directory, or null when there is none. */
const findNewestAgyLogFile = async (): Promise<string | null> => {
  let entries;
  try {
    entries = await readdir(AGY_LOG_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  const logNames = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('cli-') && entry.name.endsWith('.log'))
    .map((entry) => entry.name)
    .sort();
  const newest = logNames[logNames.length - 1];
  return newest ? path.join(AGY_LOG_DIR, newest) : null;
};

/**
 * Reads agy's own newest log for its "not logged in" line.
 *
 * Returns `true` only for a positive "not logged in" reading. A missing log
 * directory, an unreadable file, or a log with no auth line at all all return
 * `false` — the absence of the sentence is not evidence of a login.
 */
const readLoggedOutFromAgyLog = async (): Promise<boolean> => {
  const logPath = await findNewestAgyLogFile();
  if (!logPath) {
    return false;
  }

  let handle;
  try {
    handle = await open(logPath, 'r');
    const { size } = await handle.stat();
    const start = Math.max(0, size - AGY_LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString('utf8').includes(AGY_NOT_LOGGED_IN_LINE);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

/**
 * `probeAntigravityModelIds()`, given up on after `AGY_AUTH_PROBE_DEADLINE_MS`.
 *
 * The probe itself is untouched: a child that settles late is still killed by
 * the probe's own timer. Only this caller stops waiting, and `null` — the same
 * value the probe uses for "could not run" — is what it stops waiting with.
 */
const probeAgyModelIdsWithDeadline = (): Promise<string[] | null> => {
  let deadlineHandle: NodeJS.Timeout | undefined;
  const deadline = new Promise<null>((resolve) => {
    deadlineHandle = setTimeout(() => resolve(null), AGY_AUTH_PROBE_DEADLINE_MS);
  });

  return Promise.race([probeAntigravityModelIds(), deadline])
    .finally(() => clearTimeout(deadlineHandle));
};

/**
 * Whether `agy`'s own stored state says the CLI has run on this machine before.
 *
 * Both markers are `agy`'s bookkeeping about itself — the updater's last-result
 * file and the first-run onboarding marker — never credential material. Used
 * only to pick between two signed-out messages, never to claim a login.
 */
const readAgyHasRunBefore = async (): Promise<boolean> => {
  const [updateStatus, onboarding] = await Promise.all([
    readTextFile(AGY_UPDATE_STATUS_PATH),
    readTextFile(AGY_ONBOARDING_PATH),
  ]);

  return Boolean(
    (updateStatus && updateStatus.trim())
    || (onboarding && onboarding.trim()),
  );
};

/**
 * Sign-in state from non-secret signals only.
 *
 * `agy` keeps its OAuth tokens in the OS keyring (wincred on Windows), with a
 * file-storage fallback whose path was never recovered. Neither is inspected:
 * touching token material is exactly what ADR 0013 rules out, and
 * `~/.gemini/oauth_creds.json` — the obvious guess — belongs to the Gemini CLI,
 * not `agy`.
 *
 * The signals, cheapest first:
 *  1. `agy`'s own log, whose "You are not logged into Antigravity." line is a
 *     positive statement of being signed out.
 *  2. The models facet's live catalog, but only while it is still fresh.
 *     `agy models` answers an empty list when signed out, so a cache the
 *     models-list path has already warmed carries this answer for free.
 *  3. With no fresh cache, this facet's own `agy models` probe — so the answer
 *     is still owned here rather than left to whichever request path ran first
 *     — raced against `AGY_AUTH_PROBE_DEADLINE_MS`. A probe that loses the race
 *     is treated exactly like one that could not run at all.
 *
 * Nothing here can produce an email or an account identity, so `email` stays
 * null and `method` names the mechanism rather than pretending to be one.
 */
const readAgySignInState = async (): Promise<{ signedIn: boolean; error: string | undefined }> => {
  if (await readLoggedOutFromAgyLog()) {
    return { signedIn: false, error: AGY_NOT_SIGNED_IN };
  }

  const modelIds = readFreshAntigravityModelIds() ?? await probeAgyModelIdsWithDeadline();
  if (modelIds !== null) {
    return modelIds.length > 0
      ? { signedIn: true, error: undefined }
      : { signedIn: false, error: AGY_NOT_SIGNED_IN };
  }

  // `agy` inherits an existing login silently when it runs as the same OS user,
  // so a CLI that has clearly been run before is likelier signed in than not.
  // Guessing "signed in" anyway would put a provider in the picker that cannot
  // complete a turn, so this only shapes the wording.
  if (await readAgyHasRunBefore()) {
    return { signedIn: false, error: AGY_NOT_SIGNED_IN };
  }

  return {
    signedIn: false,
    error: 'Antigravity has no stored sign-in yet. Run `agy` in a terminal and sign in there.',
  };
};

export class AntigravityProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    const rawVersion = readAgyVersionOutput();
    if (rawVersion === null) {
      return {
        installed: false,
        provider: 'antigravity',
        authenticated: false,
        email: null,
        method: null,
        error: AGY_CLI_NOT_INSTALLED,
      };
    }

    const version = parseAgyVersion(rawVersion);
    // No version gate: `agy` shipped 50 releases between 1.0.0 and 1.2.6, so
    // pinning one would break a CLI the user keeps current — it runs and fails
    // loudly instead. A major-version jump is the one thing worth warning about,
    // because that is where the NDJSON surface this provider parses is most
    // likely to have changed.
    if (version && Number.parseInt(version.split('.')[0], 10) > AGY_KNOWN_MAJOR_VERSION) {
      console.warn(
        `[Antigravity] agy ${version} is newer than the ${AGY_KNOWN_MAJOR_VERSION}.x release this provider was written against; the stream-json event shapes may have changed.`,
      );
    }

    const signIn = await readAgySignInState();

    return {
      installed: true,
      provider: 'antigravity',
      authenticated: signIn.signedIn,
      email: null,
      // Sign-in only ever happens inside the CLI itself, so `cli` names the one
      // mechanism there is; null while signed out, like every other provider.
      method: signIn.signedIn ? 'cli' : null,
      error: signIn.error,
    };
  }
}
