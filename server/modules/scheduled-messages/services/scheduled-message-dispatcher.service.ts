import { scheduledMessagesDb, sessionDraftsDb } from '@/modules/database/index.js';
import type { QueuedSessionMessageRecord, ScheduledMessageRow } from '@/modules/database/index.js';
import {
  keepWaitingScheduledMessages,
  queuedMessageMustWait,
  restoreRefusedQueuedMessage,
  runScheduledTurn,
} from '@/modules/scheduled-messages/services/busy-session-sends.service.js';
import { announceScheduledMessagesChanged } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { onRunSettled, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { readQueuedChatMessage } from '@/shared/utils.js';

/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 *
 * Queued messages do not wait for this: they are also dispatched the moment
 * the run that blocked them settles (see `unsubscribeRunSettled` below). The
 * poll remains their safety net for the cases no run-settled event covers —
 * a message queued while nothing was running, or one left behind by a server
 * restart.
 */
const POLL_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeRunSettled: (() => void) | null = null;
/**
 * Sessions whose scheduled sends are still going, from this pass or an
 * earlier one. Their next due rows stay pending (and keep their banner) until
 * those sends finish, so they neither overtake nor interrupt them.
 */
const sessionsSending = new Set<string>();

/**
 * Sessions whose queued sends are still in flight, preventing concurrent re-entry
 * on the same session from racing onRunSettled calls.
 */
const queuedSending = new Set<string>();

function readOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function sendClaimedQueuedMessage(
  candidate: QueuedSessionMessageRecord,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  const message = readQueuedChatMessage(candidate.queuedMessage);
  if (!message) {
    sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
    return;
  }

  const result = await runDetachedChatTurn(
    {
      sessionId: candidate.sessionId,
      userId: candidate.userId,
      content: message.content,
      options: { ...message.options, attachments: message.attachments },
    },
    { runtime },
  );

  // The registry check and run reservation are separate operations. If a run
  // wins that tiny race, put the turn back so the next poll tries again.
  if (!result.started && result.error === 'A run was already in progress for this session.') {
    sessionDraftsDb.restoreQueuedMessage(candidate);
    return;
  }
  // Fork entry 31: the process holding background work refused it.
  if (restoreRefusedQueuedMessage(candidate, result)) {
    return;
  }
  sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
}

/**
 * Whether a queued turn has to keep waiting for the session.
 *
 * Checks both session-level send locks (sessionsSending and queuedSending)
 * and the fork entry 31 rules (turn vs. background work).
 */
function isQueuedMessageBlocked(
  candidate: QueuedSessionMessageRecord,
  runtime: ProviderRuntimeGateway,
): boolean {
  if (sessionsSending.has(candidate.sessionId) || queuedSending.has(candidate.sessionId)) {
    return true;
  }
  return queuedMessageMustWait(candidate, runtime);
}

/**
 * Sends every persisted queued turn whose session is currently idle.
 *
 * With a `sessionId`, only that session's queued turn is looked at: a run that
 * settles can only have unblocked its own session.
 */
export async function dispatchQueuedMessages(
  runtime: ProviderRuntimeGateway,
  sessionId?: string,
): Promise<number> {
  const candidates = sessionDraftsDb.listQueuedMessages(sessionId);
  let claimed = 0;

  await Promise.all(candidates.map(async (candidate) => {
    if (isQueuedMessageBlocked(candidate, runtime)) {
      return;
    }
    if (!sessionDraftsDb.claimQueuedMessage(candidate)) {
      return;
    }
    claimed += 1;
    queuedSending.add(candidate.sessionId);
    try {
      await sendClaimedQueuedMessage(candidate, runtime);
    } catch (error) {
      logPassFailure(error);
    } finally {
      queuedSending.delete(candidate.sessionId);
      if (unsubscribeRunSettled) {
        void dispatchQueuedMessages(runtime, candidate.sessionId).catch(logPassFailure);
      }
    }
  }));

  return claimed;
}

/** Records why a claimed message did not go, and shows it on its session's banner. */
function recordFailure(row: ScheduledMessageRow, reason: string): void {
  scheduledMessagesDb.markFailed(row.id, reason);
  announceScheduledMessagesChanged(row.session_id);
}

async function sendClaimedMessage(
  row: ScheduledMessageRow,
  runtime: ProviderRuntimeGateway,
): Promise<boolean> {
  try {
    // Fork entry 31: sent into the process holding background work when it
    // can be, else as the message's `onBusy` says (`interrupt` aborts a run in
    // progress, as upstream does, so it lands when it was due). Null: it went
    // back to wait.
    const result = await runScheduledTurn(row, readOptions(row.options), runtime);
    if (!result) {
      return false; // putBack: message went back to wait
    }

    // Recorded rather than retried, and recorded whether the run never started
    // (deleted session, unavailable provider) or started and then failed.
    // Silently dropping a message the user scheduled is worse than telling
    // them it did not go.
    if (!result.started || result.error) {
      recordFailure(row, result.error ?? 'The session was unavailable when this was due.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordFailure(row, message);
  }
  return true;
}

/**
 * Sends every message whose time has come and returns how many it handled.
 *
 * Exported so a test can drive one pass without waiting on the timer.
 */
export async function dispatchDueScheduledMessages(
  runtime: ProviderRuntimeGateway,
  now = new Date(),
): Promise<number> {
  // Claimed before any of them runs, so a long turn cannot let the next poll
  // pick the same message up again.
  // Fork entry 31: a `wait` message whose session is busy goes straight back.
  const due = keepWaitingScheduledMessages(scheduledMessagesDb.claimDue(now, sessionsSending), runtime);
  if (due.length === 0) {
    return 0;
  }

  // The claim already recorded them as sent, so their banners come down now,
  // as the turns start, rather than once the last turn has finished.
  for (const sessionId of new Set(due.map((row) => row.session_id))) {
    announceScheduledMessagesChanged(sessionId);
  }

  // Sessions side by side, since a turn can stay open a long time (see
  // runDispatchPass). A session's rows that were due at `now` go one after
  // another in this pass, each claimed only when the earlier send ends, so
  // none is recorded as sent while it still waits and no poll gap opens
  // between them. A turn the user starts meanwhile is still interrupted, as
  // any scheduled send interrupts the active run.
  let sent = 0;
  await Promise.all(due.map(async (first) => {
    const sessionId = first.session_id;
    sessionsSending.add(sessionId);
    try {
      let row: ScheduledMessageRow | null = first;
      while (row) {
        const sentOk = await sendClaimedMessage(row, runtime);
        if (!sentOk) {
          // If the message was put back to wait (e.g. session busy/refused),
          // stop here so claimNextDue won't immediately re-claim the put-back row.
          break;
        }
        sent += 1;
        row = scheduledMessagesDb.claimNextDue(sessionId, now);
        if (row && keepWaitingScheduledMessages([row], runtime).length === 0) {
          break;
        }
        if (row) announceScheduledMessagesChanged(sessionId);
      }
    } catch (error) {
      logPassFailure(error);
    } finally {
      sessionsSending.delete(sessionId);
      // A run that settled while this session's sends were going was skipped
      // by the run-settled listener (isQueuedMessageBlocked), so the queued turn it
      // unblocked goes now instead of waiting for the next poll.
      if (unsubscribeRunSettled) {
        void dispatchQueuedMessages(runtime, sessionId).catch(logPassFailure);
      }
    }
  }));

  return sent;
}

function logPassFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
}

/**
 * One poll's work. A send waits for its whole turn, and a Claude turn that
 * leaves background work running (a Monitor, say) stays open until that work
 * reports back, so passes must not wait on each other: claims are
 * transactional, and a queued turn skips a session that is still busy.
 *
 * Exported so a test can drive overlapping passes.
 */
export function runDispatchPass(runtime: ProviderRuntimeGateway): Promise<void> {
  return Promise.all([
    // First, so a due send that starts a run at once has registered it before
    // the queued pass checks whether that session is busy.
    dispatchDueScheduledMessages(runtime).catch(logPassFailure),
    dispatchQueuedMessages(runtime).catch(logPassFailure),
  ]).then(() => undefined);
}

export function initializeScheduledMessageDispatcher(runtime: ProviderRuntimeGateway): void {
  if (pollTimer) {
    return;
  }

  const poll = () => {
    void runDispatchPass(runtime);
  };

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  // Never keep the process alive just to poll for scheduled messages.
  pollTimer.unref?.();

  // A message queued during a turn is sent as soon as that turn ends. Without
  // this the only sender is the poll above, so the user watches an idle
  // session for up to POLL_INTERVAL_MS before their queued turn starts — the
  // frontend deliberately does not send it ("the VPS dispatcher owns sending",
  // useChatComposerState.ts). `dispatchQueuedMessages` re-checks `isQueuedMessageBlocked`
  // (which also covers a session whose scheduled sends are still going) and
  // claims transactionally, so racing with the poll is harmless. Scoped to
  // the settled session, so several runs ending together do not each rescan
  // every queued turn.
  unsubscribeRunSettled = onRunSettled((appSessionId) => {
    void dispatchQueuedMessages(runtime, appSessionId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ScheduledMessages] Run-settled dispatch failed', { error: message });
    });
  });

  // Catch up on anything that came due while the server was not running.
  poll();
}

export function closeScheduledMessageDispatcher(): void {
  if (unsubscribeRunSettled) {
    unsubscribeRunSettled();
    unsubscribeRunSettled = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
