import { scheduledMessagesDb, sessionDraftsDb } from '@/modules/database/index.js';
import type { QueuedSessionMessageRecord, ScheduledMessageRow } from '@/modules/database/index.js';
import { announceScheduledMessagesChanged } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { readQueuedChatMessage } from '@/shared/utils.js';

/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 */
const POLL_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let dispatchInFlight = false;

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
  // The process holding the session's background work could not take it (a
  // changed setting, say). Put it back to wait for that work to end, rather
  // than pushing it again on every poll.
  if (result.refused) {
    sessionDraftsDb.restoreQueuedMessage(candidate, { waitFor: 'background' });
    return;
  }
  sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
}

/** Sends every persisted queued turn whose session is currently idle. */
export async function dispatchQueuedMessages(runtime: ProviderRuntimeGateway): Promise<number> {
  const candidates = sessionDraftsDb.listQueuedMessages();
  let claimed = 0;

  await Promise.all(candidates.map(async (candidate) => {
    // A turn in flight always holds a queued message back. Background work a
    // previous turn left running — a task, or a hold the tracker cannot see,
    // like a cron — holds back only a message queued over that work on purpose
    // (`waitFor: background`, and every row from before the field). One queued
    // during a turn goes out once that turn ends, pushed into the process
    // still holding the work, which keeps running (fork entry 31); if that
    // process cannot take it, it is put back to wait for the work (above).
    // Work with no deadline can hold a message back indefinitely, so the user
    // can edit or delete it while it waits, or send it with "Send anyway".
    if (chatRunRegistry.isProcessing(candidate.sessionId)) {
      return;
    }
    const backgroundHeld = runtime.hasBackgroundWork(candidate.sessionId)
      || chatRunRegistry.hasBackgroundWorkOutstanding(candidate.sessionId);
    if (backgroundHeld && readQueuedChatMessage(candidate.queuedMessage)?.waitFor !== 'turn') {
      return;
    }
    if (!sessionDraftsDb.claimQueuedMessage(candidate)) {
      return;
    }
    claimed += 1;
    await sendClaimedQueuedMessage(candidate, runtime);
  }));

  return claimed;
}

/** Records why a claimed message did not go, and shows it on its session's banner. */
function recordFailure(row: ScheduledMessageRow, reason: string): void {
  scheduledMessagesDb.markFailed(row.id, reason);
  announceScheduledMessagesChanged(row.session_id);
}

/**
 * What a scheduled message does when it comes due while its session is busy
 * (fork entry 31). `interrupt`, the default and upstream's behaviour: it goes
 * out on time, aborting a turn in flight and, when the process holding the
 * session's background work cannot take it, stopping that work. `wait`: it
 * stays scheduled until the turn has ended and, if that process could not take
 * it, until the work has ended too. Either way a message the held process can
 * take goes into it and stops nothing.
 */
type ScheduledBusyMode = 'interrupt' | 'wait';

function readBusyMode(options: Record<string, unknown>): ScheduledBusyMode {
  return options.onBusy === 'wait' ? 'wait' : 'interrupt';
}

/**
 * `wait` messages the process holding their session's background work has
 * already refused: they are not pushed again, only sent once that work has
 * ended. In memory, so a restart costs at most one more refused push.
 */
const waitingOutBackgroundWork = new Set<string>();

function holdsBackgroundWork(sessionId: string, runtime: ProviderRuntimeGateway): boolean {
  return runtime.hasBackgroundWork(sessionId) || chatRunRegistry.hasBackgroundWorkOutstanding(sessionId);
}

/** Whether a due `wait` message has to stay scheduled for now. */
function mustKeepWaiting(row: ScheduledMessageRow, runtime: ProviderRuntimeGateway): boolean {
  if (chatRunRegistry.isProcessing(row.session_id)) {
    return true;
  }
  if (!waitingOutBackgroundWork.has(row.id)) {
    return false;
  }
  if (holdsBackgroundWork(row.session_id, runtime)) {
    return true;
  }
  waitingOutBackgroundWork.delete(row.id);
  return false;
}

async function sendClaimedMessage(
  row: ScheduledMessageRow,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  const { onBusy, ...options } = readOptions(row.options);
  const busyMode = readBusyMode({ onBusy });
  const send = (interruptBackground: boolean) => runDetachedChatTurn(
    {
      sessionId: row.session_id,
      userId: row.user_id,
      content: row.content,
      options,
      // The user picked this time on purpose; a run that happens to be going
      // is aborted so the scheduled message lands when it was due, instead
      // of being recorded as "not sent — session was busy". A `wait` message
      // was only claimed with no turn in flight, so it never aborts one.
      interruptActiveRun: busyMode === 'interrupt',
      interruptBackground,
    },
    { runtime },
  );

  try {
    let result = await send(false);

    if (result.refused) {
      if (busyMode === 'wait') {
        // Back on the banner until the work it could not join has ended.
        waitingOutBackgroundWork.add(row.id);
        scheduledMessagesDb.releaseClaim(row.id);
        announceScheduledMessagesChanged(row.session_id);
        return;
      }
      // On time, as upstream sends it: the held process could not take the
      // message, so its background work is stopped and the message sent.
      result = await send(true);
    }

    if (busyMode === 'wait' && !result.started && result.error === 'A run was already in progress for this session.') {
      // A turn started between the check and this send: try again later.
      scheduledMessagesDb.releaseClaim(row.id);
      announceScheduledMessagesChanged(row.session_id);
      return;
    }

    // Recorded rather than retried, and recorded whether the run never started
    // (deleted session, unavailable provider) or started and then failed — or
    // was refused again. Silently dropping a message the user scheduled is
    // worse than telling them it did not go.
    if (!result.started || result.error || result.refused) {
      recordFailure(row, result.error ?? (result.refused
        ? 'The session\'s background work could not be stopped for this message.'
        : 'The session was unavailable when this was due.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordFailure(row, message);
  }
}

/**
 * Sends every message whose time has come.
 *
 * Exported so a test can drive one pass without waiting on the timer.
 */
export async function dispatchDueScheduledMessages(
  runtime: ProviderRuntimeGateway,
  now: Date = new Date(),
): Promise<number> {
  // Claimed before any of them runs, so a long turn cannot let the next poll
  // pick the same message up again. A `wait` message whose session is busy
  // goes straight back to pending, before anyone is told of the claim.
  const claimed = scheduledMessagesDb.claimDue(now);
  const due = claimed.filter((row) => {
    if (readBusyMode(readOptions(row.options)) === 'wait' && mustKeepWaiting(row, runtime)) {
      scheduledMessagesDb.releaseClaim(row.id);
      return false;
    }
    return true;
  });
  if (due.length === 0) {
    return 0;
  }

  // The claim already recorded them as sent, so their banners come down now,
  // as the turns start, rather than once the last turn has finished.
  for (const sessionId of new Set(due.map((row) => row.session_id))) {
    announceScheduledMessagesChanged(sessionId);
  }

  // Sequentially: a session can only have one run at a time, and two due
  // messages for the same session must not race each other into it.
  for (const row of due) {
    await sendClaimedMessage(row, runtime);
  }

  return due.length;
}

/**
 * Starts the poll that sends scheduled messages.
 *
 * The schedule lives in the database, so a message stays scheduled across a
 * restart and one that came due while the server was down is sent on the first
 * poll after it comes back, rather than being skipped.
 */
export function initializeScheduledMessageDispatcher(runtime: ProviderRuntimeGateway): void {
  if (pollTimer) {
    return;
  }

  const poll = () => {
    // A pass that overruns the interval must not be started again underneath
    // itself; the claim is transactional but the runs are not.
    if (dispatchInFlight) {
      return;
    }
    dispatchInFlight = true;
    void dispatchDueScheduledMessages(runtime)
      .then(() => dispatchQueuedMessages(runtime))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
      })
      .finally(() => {
        dispatchInFlight = false;
      });
  };

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  // Never keep the process alive just to poll for scheduled messages.
  pollTimer.unref?.();

  // Catch up on anything that came due while the server was not running.
  poll();
}

export function closeScheduledMessageDispatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
