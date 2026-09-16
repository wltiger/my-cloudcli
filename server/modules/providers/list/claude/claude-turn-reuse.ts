import type { AnyRecord } from '@/shared/types.js';

/**
 * A Claude run that has finished its turn but is still holding its CLI process
 * open for outstanding background work, parked on an input stream that can
 * still accept another turn.
 */
type HeldTurnHandle = {
  /**
   * Fingerprint of the settings the live SDK query was constructed with. A
   * follow-up turn may only be pushed into it when its own fingerprint matches
   * exactly — anything else needs a query built with the new settings.
   */
  fingerprint: string;
  /**
   * Rebinds the live run to the follow-up turn's writer and pushes its prompt
   * into the held input stream. Returns a promise that settles when the pushed
   * turn produces its `result`, or `null` when the stream closed first (the
   * caller then starts a fresh query, as it always did).
   */
  tryAccept: (input: {
    writer: unknown;
    sessionSummary?: string;
    promptMessages: AnyRecord[];
  }) => Promise<void> | null;
};

/**
 * Held runs by session key, at most one per session.
 *
 * Deliberately separate from the runtime's `activeSessions` map: an entry
 * exists only for the window where the run is genuinely parked and waiting for
 * input, which is narrower than "this session has a live query instance".
 */
const heldTurns = new Map<string, HeldTurnHandle>();

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').slice().sort()
    : [];
}

/**
 * Fingerprints everything about a turn that the SDK query is constructed with,
 * so an unchanged follow-up can be recognised.
 *
 * Used by `claude-runtime.provider.js`: it stamps every run's fingerprint onto
 * the handle it parks, and compares the next turn's against it before pushing
 * a prompt into a process built for the previous turn's settings.
 *
 * Deliberately strict: any difference at all blocks reuse and falls back to the
 * pre-existing "tear the process down and start a fresh query" path, which is
 * always correct. Settings that could instead be renegotiated on the live
 * process belong in a later, looser gate.
 *
 * The provider-native session id is excluded on purpose. It only feeds the
 * SDK's `resume` option, and a turn pushed into a live process continues that
 * process's own conversation — there is nothing to resume. Including it would
 * block reuse for the first follow-up of every brand-new session, whose id is
 * only captured mid-run.
 */
export function buildTurnSettingsFingerprint(options: AnyRecord = {}): string {
  const toolsSettings = (options.toolsSettings ?? {}) as AnyRecord;

  return JSON.stringify({
    model: options.model ?? null,
    effort: options.effort ?? null,
    permissionMode: options.permissionMode ?? null,
    cwd: options.cwd ?? null,
    allowedTools: readStringList(toolsSettings.allowedTools),
    disallowedTools: readStringList(toolsSettings.disallowedTools),
    skipPermissions: Boolean(toolsSettings.skipPermissions),
    // An edited message needs a query that resumes the transcript partway, so
    // it can never be pushed into a process already past that point.
    resumeAnchorId: options.resumeAnchorId ?? null,
    resumeFromScratch: Boolean(options.resumeFromScratch),
  });
}

/**
 * Publishes a parked run as available for a matching follow-up turn.
 *
 * Used by `claude-runtime.provider.js` from its `result` handler, every time a
 * turn ends with background work still outstanding and the process held open.
 */
export function registerHeldTurn(sessionKey: string, handle: HeldTurnHandle | null): void {
  if (!sessionKey || !handle) {
    return;
  }
  heldTurns.set(sessionKey, handle);
}

/**
 * Drops a handle once its process is released; a no-op for a superseded one.
 *
 * Used by `claude-runtime.provider.js` from the single closer it hands to
 * `activeSessions`, so every way a run's stdin can close — an ordinary turn, an
 * abort, the idle ceiling, a superseding run — also unpublishes its handle.
 */
export function forgetHeldTurn(sessionKey: string, handle: HeldTurnHandle | null): void {
  if (!sessionKey || !handle) {
    return;
  }
  if (heldTurns.get(sessionKey) === handle) {
    heldTurns.delete(sessionKey);
  }
}

/**
 * Takes the session's held run when `fingerprint` matches its settings.
 *
 * Used by `claude-runtime.provider.js` at the head of every turn, before it
 * would otherwise release the previous hold and build a query of its own.
 *
 * Claiming removes the handle so two follow-ups cannot both push into the same
 * parked run; the run re-registers itself the next time it parks.
 */
export function claimHeldTurn(sessionKey: string, fingerprint: string): HeldTurnHandle | null {
  const handle = sessionKey ? heldTurns.get(sessionKey) : undefined;
  if (!handle || handle.fingerprint !== fingerprint) {
    return null;
  }

  heldTurns.delete(sessionKey);
  return handle;
}
