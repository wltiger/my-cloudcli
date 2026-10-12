import type { AnyRecord } from '@/shared/types.js';

/**
 * One registered hook callback, in the shape the SDK's `hooks` option takes.
 */
type HookMatcher = {
  matcher: string;
  hooks: Array<(input: AnyRecord) => Promise<AnyRecord>>;
};

/**
 * The Stop-hook view of what a Claude run still has in flight.
 */
type ClaudeBackgroundWorkSnapshot = {
  /** Hook entries to merge into the SDK query's `hooks` option. */
  buildHooks: () => Record<string, HookMatcher[]>;
  /** Feeds one SDK stream message, so a stopped task leaves the snapshot. */
  observe: (sdkMessage: unknown) => void;
  /** True once a hook reported a usable snapshot of the session's in-flight work. */
  hasSnapshot: () => boolean;
  /** Whether the newest snapshot still lists a task or a scheduled cron. */
  snapshotOutstanding: () => boolean;
};

/**
 * Builds the background-work snapshot source for a single Claude run.
 *
 * Used by `claude-runtime.provider.js` as the third signal next to the task
 * tracker and `startsBackgroundWork`: one snapshot source per run, consulted
 * wherever that run decides between closing the CLI's stdin and holding it
 * open. Its unique job is the work neither of those can see — a cron set up in
 * an earlier turn (cron events carry no `task_id`, so the tracker never gets
 * them) and tools that emit no task events at all.
 *
 * The reading comes from the SDK's `Stop` / `SubagentStop` hooks, which report a
 * point-in-time snapshot of the session's in-flight background tasks and
 * scheduled crons as the turn wraps up. `Stop` fires immediately before the
 * turn's `result`, so the newest snapshot at that moment is the answer to "is
 * anything still running?".
 *
 * A task the user stops never fires another `Stop` — only its `stopped`
 * notification — so the snapshot keeps the task ids it listed and drops one
 * when that notification arrives. Without that, a stopped last task would leave
 * the snapshot saying "outstanding" for good and the process would sit until
 * the idle ceiling.
 *
 * `SubagentStop` is registered too, but only as a stand-in for a `Stop` that
 * never arrives. Its snapshot is self-inclusive — it still lists the subagent
 * that is stopping as running — so taking it as final would hold every subagent
 * turn open. That is safe only because of the ordering above: the turn-ending
 * `Stop` lands between any `SubagentStop` and the `result` this snapshot is read
 * at, so it always has the last word at the moment that decides. A late
 * `SubagentStop` during a hold can therefore only bias towards holding longer,
 * which the run's own idle ceiling bounds.
 */
export function createBackgroundWorkSnapshot(): ClaudeBackgroundWorkSnapshot {
  // Task ids the newest usable hook reading listed; null until one arrives,
  // which is also how a run whose hooks the SDK refused never holds on this
  // source. Deliberately kept across turns of the same run: a turn that somehow
  // produces no snapshot then reuses the previous one (holding too long, which
  // the ceiling ends) rather than reading silence as "nothing outstanding" and
  // killing live work.
  let taskIds: Set<string> | null = null;
  let cronCount = 0;

  const recordSnapshot = async (input: AnyRecord): Promise<AnyRecord> => {
    const tasks = input?.background_tasks;
    const crons = input?.session_crons;
    if (!Array.isArray(tasks) && !Array.isArray(crons)) {
      // An SDK build that reports neither list tells us nothing; an absent
      // snapshot is not an empty one, so the previous reading stands.
      return {};
    }

    // Keyed by the summary's `id`, which is what a `task_notification`'s
    // `task_id` is matched against. A summary without one gets a key no
    // notification can match, so it only ever biases towards holding.
    taskIds = new Set(Array.isArray(tasks)
      ? tasks.map((task: AnyRecord, index: number) =>
        (typeof task?.id === 'string' ? task.id : `unidentified:${index}`))
      : []);
    cronCount = Array.isArray(crons) ? crons.length : 0;
    return {};
  };

  return {
    buildHooks: () => {
      const matchers: HookMatcher[] = [{ matcher: '', hooks: [recordSnapshot] }];
      return { Stop: matchers, SubagentStop: matchers };
    },
    observe: (sdkMessage) => {
      const message = sdkMessage as AnyRecord;
      if (
        !taskIds
        || message?.type !== 'system'
        || message.subtype !== 'task_notification'
        || message.status !== 'stopped'
        || typeof message.task_id !== 'string'
      ) {
        return;
      }
      if (!taskIds.delete(message.task_id) && taskIds.size > 0) {
        // The SDK does not promise that a summary's `id` and a notification's
        // `task_id` name a task the same way; say so when they disagree, since
        // the snapshot then keeps holding until the next Stop or the ceiling.
        console.warn(
          `[Claude SDK] Stopped task ${message.task_id} is not in the background-work snapshot (${[...taskIds].join(', ')}).`,
        );
      }
    },
    hasSnapshot: () => taskIds !== null,
    snapshotOutstanding: () => taskIds !== null && (taskIds.size > 0 || cronCount > 0),
  };
}
