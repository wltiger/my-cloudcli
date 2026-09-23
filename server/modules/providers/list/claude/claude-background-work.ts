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
  /** True once a hook reported a usable snapshot of the session's in-flight work. */
  hasSnapshot: () => boolean;
  /** Whether work that outlives this turn is still outstanding. */
  hasOutstandingWork: () => boolean;
  /**
   * Why work is outstanding, for the decision log: the hook's reading, an
   * explicit start observed in this turn's stream, or `null` when nothing is.
   */
  outstandingReason: () => 'snapshot' | 'observed-start' | null;
};

/**
 * Detects the tool calls that start work outliving the turn, on the caller's
 * say-so.
 *
 * Only an explicit `run_in_background: true` counts. A foreground subagent —
 * the common case — finishes inside the turn and must not hold a process
 * open, and it never carries the flag, so it never matches. `Bash` is the
 * case the CLI sweeps fastest on wind-down (a five-second grace), which is why
 * this signal has to exist at all; the subagent names are there so the same
 * guard covers work the CLI keeps alive for up to the bg-wait ceiling.
 */
const BACKGROUND_WORK_TOOLS = new Set(['Bash', 'Agent', 'Task']);

function startsBackgroundWork(sdkMessage: unknown): boolean {
  const content = (sdkMessage as AnyRecord)?.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((block: AnyRecord) =>
    block?.type === 'tool_use'
    && BACKGROUND_WORK_TOOLS.has(block.name as string)
    && block.input?.run_in_background === true);
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
 * One reading the snapshot is not allowed to answer is the turn's own: an
 * explicit `run_in_background` start observed in this turn's stream holds the
 * process regardless of what the snapshot says, because the CLI can take the
 * snapshot before it has registered the task the turn just started. An empty
 * reading at that instant is a timing artefact, not an answer — trusting it is
 * what let a freshly backgrounded shell be swept on wind-down. The bias is
 * towards holding a little longer, which the run's own idle ceiling ends.
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
  let backgroundWorkStarted = false;
  // One race warning per turn, so a Stop and its SubagentStop do not both report it.
  let raceWarned = false;

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
    if (!snapshotOutstanding && backgroundWorkStarted && !raceWarned) {
      raceWarned = true;
      console.warn(
        '[Claude SDK] Background-work snapshot reports nothing in flight, but this turn explicitly started background work — the task may not be registered yet. Holding on the observed start.',
      );
    }
    return {};
  };

  const hasSnapshot = (): boolean => snapshotOutstanding !== null;

  const outstandingReason = (): 'snapshot' | 'observed-start' | null =>
    hasSnapshot() && snapshotOutstanding === true ? 'snapshot'
      : backgroundWorkStarted ? 'observed-start'
        : null;

  return {
    buildHooks: () => {
      const matchers: HookMatcher[] = [{ matcher: '', hooks: [recordSnapshot] }];
      return { Stop: matchers, SubagentStop: matchers };
    },
    observeMessage: (sdkMessage) => {
      if (startsBackgroundWork(sdkMessage)) {
        backgroundWorkStarted = true;
      }
    },
    resetFallbackSignal: () => {
      backgroundWorkStarted = false;
      raceWarned = false;
    },
    hasSnapshot,
    outstandingReason,
    hasOutstandingWork: () => outstandingReason() !== null,
  };
}
