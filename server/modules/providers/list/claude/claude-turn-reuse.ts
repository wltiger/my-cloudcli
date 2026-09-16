import { createHash } from 'node:crypto';

import type { AnyRecord } from '@/shared/types.js';

/**
 * The settings a live SDK query can adopt without being rebuilt.
 *
 * Everything here has an in-flight equivalent: the SDK's `setModel`,
 * `setPermissionMode`, `setMcpServers` and `applyFlagSettings` control
 * requests, plus this runtime's own tool-use gate, which reads them through
 * {@link createLiveTurnSettings} rather than closing over a first-turn snapshot.
 */
type HotTurnSettings = {
  model: string | null;
  permissionMode: string;
  allowedTools: string[];
  disallowedTools: string[];
  mcpServers: AnyRecord;
};

/**
 * A Claude run that has finished its turn but is still holding its CLI process
 * open for outstanding background work, parked on an input stream that can
 * still accept another turn.
 */
type HeldTurnHandle = {
  /**
   * Fingerprint of everything the live SDK query cannot renegotiate. A
   * follow-up turn may only be pushed into it when its own fingerprint matches
   * exactly — anything else needs a query built with the new settings.
   */
  fingerprint: string;
  /**
   * Applies the follow-up turn's hot-reloadable settings to the live query,
   * rebinds the run to that turn's writer, and pushes its prompt into the held
   * input stream. Resolves to the promise that settles when the pushed turn
   * produces its `result`, or to `null` when the live process could not take
   * the turn after all — the stream closed first, or it refused one of the
   * in-flight changes. The caller then starts a fresh query, as it always did.
   */
  tryAccept: (input: {
    writer: unknown;
    sessionSummary?: string;
    promptMessages: AnyRecord[];
    settings: HotTurnSettings;
  }) => Promise<{ settled: Promise<void> } | null>;
};

/**
 * Per-run view of the settings a follow-up turn may change in flight.
 *
 * Exists because this runtime enforces tool permissions itself, in the
 * `canUseTool` callback the SDK calls back into. That callback used to read the
 * options object the query was constructed with, so a permission mode or tool
 * list changed by a later turn would have been reported by the SDK while the
 * runtime's own gate kept enforcing the first turn's rules — including the case
 * where the user tightens permissions and the gate keeps auto-allowing under
 * the older, looser mode. The gate reads `current()` instead, and `adopt()` is
 * the only writer.
 */
type LiveTurnSettings = {
  /** The rules the runtime's tool-use gate must enforce right now. */
  current: () => HotTurnSettings;
  /** Records a tool the user chose to always allow while this process lives. */
  rememberAllowed: (entry: string) => void;
  /**
   * Hands a follow-up turn's settings to the live query and to the gate.
   * Resolves false when the query refused a change, which means the turn needs
   * a process of its own rather than one that half-adopted it.
   */
  adopt: (queryInstance: AnyRecord, next: HotTurnSettings) => Promise<boolean>;
};

/**
 * Held runs by session key, at most one per session.
 *
 * Deliberately separate from the runtime's `activeSessions` map: an entry
 * exists only for the window where the run is genuinely parked and waiting for
 * input, which is narrower than "this session has a live query instance".
 */
const heldTurns = new Map<string, HeldTurnHandle>();

/** Told whenever a session starts or stops holding a process for outstanding work. */
type HeldTurnObserver = (sessionKey: string, outstanding: boolean) => void;

let heldTurnObserver: HeldTurnObserver | null = null;

/**
 * Registers the one observer of "is this session holding work that would die
 * with its process?".
 *
 * This map is the only place that knows the answer, and it sees both edges: a
 * run publishes itself here the moment it parks with work outstanding, and
 * unpublishes when its stdin is released for any reason.
 *
 * It is a callback rather than a direct write into the chat run registry because
 * the dependency only runs one way: the websocket module knows about providers,
 * not the reverse. Its bridge subscribes on load and forwards each edge into the
 * registry, which is what puts the state in front of the UI.
 *
 * `sessionKey` is the app session id for every run the chat gateway starts,
 * which is the key the registry uses. A direct API caller with no app session
 * parks under a provider-native id instead; it has no run in the registry and no
 * UI watching it, so the report simply has no audience.
 */
export function watchHeldTurns(observer: HeldTurnObserver | null): void {
  heldTurnObserver = observer;
}

function publishBackgroundWorkState(sessionKey: string, outstanding: boolean): void {
  try {
    heldTurnObserver?.(sessionKey, outstanding);
  } catch (error) {
    // Never let a reporting failure change whether a process is held.
    console.warn(
      '[Claude SDK] Could not report background-work state for a held turn:',
      (error as Error)?.message || error,
    );
  }
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Order-independent reading of an MCP server set, for change detection. */
function describeMcpServers(servers: AnyRecord): string {
  return JSON.stringify(
    Object.keys(servers).sort().map((name) => [name, servers[name]]),
  );
}

/** Order-independent reading of a turn's tool rules, for change detection. */
function describeToolRules(settings: HotTurnSettings): string {
  return JSON.stringify([
    settings.allowedTools.slice().sort(),
    settings.disallowedTools.slice().sort(),
  ]);
}

/**
 * Fingerprints everything about a turn that is fixed when the CLI process is
 * spawned, so a follow-up that changed only what can be renegotiated in flight
 * can be recognised.
 *
 * Used by `claude-runtime.provider.js`: it stamps every run's fingerprint onto
 * the handle it parks, and compares the next turn's against it before pushing a
 * prompt into a process built for the previous turn's settings.
 *
 * Reads the mapped SDK options rather than the raw request so it sees the same
 * values the process was actually started with — a `skipPermissions` folded
 * into the permission mode, an effort level already validated against the
 * chosen model's catalog entry, the endpoint environment already resolved.
 *
 * What is deliberately *not* here:
 * - The model, permission mode, tool lists and MCP servers, which a live query
 *   adopts through {@link HotTurnSettings}.
 * - The provider-native session id. It only feeds the SDK's `resume` option,
 *   and a turn pushed into a live process continues that process's own
 *   conversation — there is nothing to resume. Including it would block reuse
 *   for the first follow-up of every brand-new session, whose id is only
 *   captured mid-run.
 * - The resume anchor, which is not a match/mismatch question at all: see
 *   {@link carriesResumeAnchor}.
 */
export function buildTurnSettingsFingerprint(sdkOptions: AnyRecord = {}): string {
  const env = (sdkOptions.env ?? {}) as AnyRecord;
  const apiKey = typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY : null;

  return JSON.stringify({
    cwd: sdkOptions.cwd ?? null,
    // Effort has no in-flight equivalent this runtime can rely on. The closest
    // is `applyFlagSettings`' `effortLevel`, but that is the settings layer's
    // *persisted* level over a narrower set of values ('low' | 'medium' |
    // 'high' | 'xhigh') than the `effort` option a query is built with (which
    // also takes 'max' and a raw token count), so the two are not documented as
    // the same knob and nothing here has verified that they behave as one. A
    // changed effort therefore gets a new process, which always applies it.
    effort: sdkOptions.effort ?? null,
    settings: sdkOptions.settings ?? null,
    // Endpoint attribution: a custom Claude endpoint's base URL and key are
    // baked into the child process's environment at spawn time, so crossing
    // between the subscription and an endpoint — or between two endpoints —
    // needs a new process. The key is hashed because the fingerprint is kept
    // in memory for the lifetime of a hold; the digest distinguishes two
    // endpoints just as well as the secret itself.
    baseUrl: env.ANTHROPIC_BASE_URL ?? null,
    apiKey: apiKey === null ? null : createHash('sha256').update(apiKey).digest('hex'),
  });
}

/**
 * True for a turn that re-runs the conversation from an earlier point — an Edit
 * of any message, not just the first.
 *
 * Used by `claude-runtime.provider.js` to refuse reuse outright rather than to
 * compare fingerprints: a live process is always positioned at the end of its
 * own transcript and cannot rewind in flight, so no held process is ever right
 * for such a turn — not even one whose own turn carried the same anchor.
 */
export function carriesResumeAnchor(options: AnyRecord = {}): boolean {
  return Boolean(options.resumeAnchorId) || Boolean(options.resumeFromScratch);
}

/**
 * Reads the hot-reloadable half of a turn's mapped SDK options.
 *
 * Used by `claude-runtime.provider.js` for both sides of the reuse decision:
 * the run's own starting state, and what a follow-up turn asks the live process
 * to adopt.
 */
export function readHotTurnSettings(sdkOptions: AnyRecord = {}): HotTurnSettings {
  return {
    model: typeof sdkOptions.model === 'string' ? sdkOptions.model : null,
    // The SDK's default when the option is left off, spelled out so two turns
    // that mean the same thing compare equal.
    permissionMode: typeof sdkOptions.permissionMode === 'string' ? sdkOptions.permissionMode : 'default',
    allowedTools: readStringList(sdkOptions.allowedTools),
    disallowedTools: readStringList(sdkOptions.disallowedTools),
    mcpServers: { ...(sdkOptions.mcpServers ?? {}) },
  };
}

/**
 * Builds the live settings a run's tool-use gate reads, starting from the
 * settings its query was constructed with.
 *
 * Used by `claude-runtime.provider.js`: one per run, read by `canUseTool` and
 * written only when a follow-up turn is accepted into the held process.
 */
export function createLiveTurnSettings(initial: HotTurnSettings): LiveTurnSettings {
  let settings = initial;

  return {
    current: () => settings,
    rememberAllowed: (entry) => {
      settings = {
        ...settings,
        allowedTools: settings.allowedTools.includes(entry)
          ? settings.allowedTools
          : [...settings.allowedTools, entry],
        disallowedTools: settings.disallowedTools.filter((tool) => tool !== entry),
      };
    },
    adopt: async (queryInstance, next) => {
      const previous = settings;
      // The gate is updated before the control requests, not after: background
      // work from an earlier turn can call it at any moment during the hold, so
      // a tightened rule must not wait on a round-trip to the CLI.
      settings = next;
      try {
        if (next.permissionMode !== previous.permissionMode) {
          await queryInstance.setPermissionMode(next.permissionMode);
        }
        if (describeToolRules(next) !== describeToolRules(previous)) {
          // The gate above is not enough on its own. The CLI evaluates the
          // tool lists the process was spawned with before it ever asks this
          // runtime, so a tool the first turn auto-allowed would keep being
          // auto-allowed without the gate seeing it. Pushing the new lists into
          // the flag-settings layer is what the CLI itself then denies on —
          // deny rules outrank allow rules, so a tightening lands even though
          // the spawn-time allow list is still there. The reverse does not: a
          // tool *removed* from the deny list stays out of the model's context
          // until a new process, because that is a spawn-time capability, not
          // a rule.
          await queryInstance.applyFlagSettings({
            permissions: { allow: next.allowedTools, deny: next.disallowedTools },
          });
        }
        if (next.model !== previous.model) {
          await queryInstance.setModel(next.model ?? undefined);
        }
        if (describeMcpServers(next.mcpServers) !== describeMcpServers(previous.mcpServers)) {
          await queryInstance.setMcpServers(next.mcpServers);
        }
        return true;
      } catch (error) {
        // Back to the rules this process has been running under all along. It
        // is about to be released, but not instantly, and whatever work is
        // still in flight on it should keep being judged by the settings it
        // started with rather than by a turn it never accepted.
        settings = previous;
        console.warn(
          '[Claude SDK] Live query refused a settings change; starting a new process instead:',
          (error as Error)?.message || error,
        );
        return false;
      }
    },
  };
}

/**
 * Publishes a parked run as available for a compatible follow-up turn.
 *
 * Used by `claude-runtime.provider.js` from its `result` handler, every time a
 * turn ends with background work still outstanding and the process held open.
 */
export function registerHeldTurn(sessionKey: string, handle: HeldTurnHandle | null): void {
  if (!sessionKey || !handle) {
    return;
  }
  heldTurns.set(sessionKey, handle);
  publishBackgroundWorkState(sessionKey, true);
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
  // Reported from the map's state rather than from "did this call delete
  // something", because the two differ in both directions. A handle claimed by a
  // follow-up turn is already out of the map while its work carries on, so the
  // release that ends that turn has nothing to delete and would otherwise leave
  // the session showing a hold forever. And a stale handle whose session has
  // since parked a newer run must not retire that newer run's hold.
  publishBackgroundWorkState(sessionKey, heldTurns.has(sessionKey));
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
