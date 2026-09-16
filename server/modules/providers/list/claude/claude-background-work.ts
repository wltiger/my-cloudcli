import type { AnyRecord } from '@/shared/types.js';

/**
 * One registered hook callback, in the shape the SDK's `hooks` option takes.
 */
type HookMatcher = {
  matcher: string;
  hooks: Array<(input: AnyRecord) => Promise<AnyRecord>>;
};

/**
 * Tracks whether a Claude run still has work that would die with its process.
 */
type ClaudeBackgroundWorkLedger = {
  /** Hook entries to merge into the SDK query's `hooks` option. */
  buildHooks: () => Record<string, HookMatcher[]>;
  /** Feeds one SDK stream message to the fallback signal. */
  observeMessage: (sdkMessage: unknown) => void;
  /** Clears the per-turn fallback signal once a turn's `result` has been judged. */
  resetFallbackSignal: () => void;
  /** True once a hook reported a usable snapshot, which then overrides the fallback. */
  hasSnapshot: () => boolean;
  /** Whether work that outlives this turn is still outstanding. */
  hasOutstandingWork: () => boolean;
};

/**
 * Detects the one tool call the fallback still has to recognise.
 *
 * A backgrounded `Bash` is the case the CLI sweeps fastest (a five-second grace),
 * so it needs a signal that does not depend on a hook round-trip. Every other
 * tool — subagents above all — is left out on purpose: they are the common case
 * and are almost always finished by the time the turn ends, so flagging them by
 * name would hold a process open for nothing on most turns.
 */
function startsBackgroundBash(sdkMessage: unknown): boolean {
  const content = (sdkMessage as AnyRecord)?.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((block: AnyRecord) =>
    block?.type === 'tool_use' && block.name === 'Bash' && block.input?.run_in_background === true);
}

/**
 * Builds the background-work ledger for a single Claude run.
 *
 * Used by `claude-runtime.provider.js`: one ledger per run, consulted wherever
 * that run decides between closing the CLI's stdin and holding it open — the
 * turn-ending `result` and the cleanup path that runs when the message loop
 * ends for any other reason.
 *
 * The reading comes from the SDK's `Stop` / `SubagentStop` hooks, which report a
 * point-in-time snapshot of the session's in-flight background tasks and
 * scheduled crons as the turn wraps up. `Stop` fires immediately before the
 * turn's `result`, so the newest snapshot at that moment is the answer to "is
 * anything still running?".
 *
 * A snapshot is used rather than a task-started/task-settled tally on purpose: a
 * counter that misses a settle event never returns to zero and holds the process
 * open forever, while a snapshot simply reports whatever is outstanding right
 * now and cannot drift.
 *
 * `SubagentStop` is registered too, but only as a stand-in for a `Stop` that
 * never arrives. Its snapshot is self-inclusive — it still lists the subagent
 * that is stopping as running — so taking it as final would hold every subagent
 * turn open. That is safe only because of the ordering above: the turn-ending
 * `Stop` lands between any `SubagentStop` and the `result` this ledger is read
 * at, so it always has the last word at the moment that decides. A late
 * `SubagentStop` during a hold can therefore only bias towards holding longer,
 * which the run's own idle ceiling bounds.
 */
export function createBackgroundWorkLedger(): ClaudeBackgroundWorkLedger {
  // Newest usable hook reading; null until one arrives, which is also how a run
  // whose hooks the SDK refused ends up on the fallback — no hook can fire, so
  // no snapshot can ever override it. Deliberately kept across turns of the same
  // run: a turn that somehow produces no snapshot then reuses the previous one
  // (holding too long, which the ceiling ends) rather than reading silence as
  // "nothing outstanding" and killing live work.
  let snapshotOutstanding: boolean | null = null;
  // Fallback signal for the current turn.
  let backgroundBashStarted = false;

  const recordSnapshot = async (input: AnyRecord): Promise<AnyRecord> => {
    const tasks = input?.background_tasks;
    const crons = input?.session_crons;
    if (!Array.isArray(tasks) && !Array.isArray(crons)) {
      // An SDK build that reports neither list tells us nothing; an absent
      // snapshot is not an empty one, so the previous reading stands.
      return {};
    }

    snapshotOutstanding = (Array.isArray(tasks) && tasks.length > 0)
      || (Array.isArray(crons) && crons.length > 0);
    return {};
  };

  const hasSnapshot = (): boolean => snapshotOutstanding !== null;

  return {
    buildHooks: () => {
      const matchers: HookMatcher[] = [{ matcher: '', hooks: [recordSnapshot] }];
      return { Stop: matchers, SubagentStop: matchers };
    },
    observeMessage: (sdkMessage) => {
      if (startsBackgroundBash(sdkMessage)) {
        backgroundBashStarted = true;
      }
    },
    resetFallbackSignal: () => {
      backgroundBashStarted = false;
    },
    hasSnapshot,
    hasOutstandingWork: () => (hasSnapshot() ? snapshotOutstanding === true : backgroundBashStarted),
  };
}
