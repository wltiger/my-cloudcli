import { scheduledMessagesDb, sessionDraftsDb } from '@/modules/database/index.js';
import type { QueuedSessionMessageRecord, ScheduledMessageRow } from '@/modules/database/index.js';
import { announceScheduledMessagesChanged } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { readQueuedChatMessage } from '@/shared/utils.js';

/**
 * The fork's rules for the sends the scheduled-message dispatcher makes into a
 * busy session (fork entry 31), kept out of the upstream dispatcher so it only
 * calls them.
 *
 * The rule throughout: a message the process holding the session's background
 * work can take goes into it and stops nothing. Only when that process refuses
 * it (the Claude runtime's `background_work_not_kept`) does the message either
 * wait for the work or stop it, as the user chose.
 */

type DetachedTurnResult = Awaited<ReturnType<typeof runDetachedChatTurn>>;

/** Whether the session still holds background work: a task, or a hold the tracker cannot see, like a cron. */
function holdsBackgroundWork(sessionId: string, runtime: ProviderRuntimeGateway): boolean {
  return runtime.hasBackgroundWork(sessionId) || chatRunRegistry.hasBackgroundWorkOutstanding(sessionId);
}

/**
 * Whether a queued message has to keep waiting.
 *
 * A turn in flight always holds it back. Background work holds back only a
 * message queued over that work on purpose (`waitFor: background`, and every
 * row from before the field): one queued during a turn goes out once that
 * turn ends, pushed into the process still holding the work. Work with no
 * deadline can hold a message back indefinitely, so the user can edit or
 * delete it while it waits, or send it with "Send anyway".
 */
export function queuedMessageMustWait(candidate: QueuedSessionMessageRecord, runtime: ProviderRuntimeGateway): boolean {
  if (chatRunRegistry.isProcessing(candidate.sessionId)) {
    return true;
  }
  return holdsBackgroundWork(candidate.sessionId, runtime)
    && readQueuedChatMessage(candidate.queuedMessage)?.waitFor !== 'turn';
}

/**
 * Puts a claimed queued message the held process refused back in the queue,
 * now waiting for that work to end rather than pushed again on every poll.
 * Returns whether it did.
 */
export function restoreRefusedQueuedMessage(candidate: QueuedSessionMessageRecord, result: DetachedTurnResult): boolean {
  if (!result.refused) {
    return false;
  }
  sessionDraftsDb.restoreQueuedMessage(candidate, { waitFor: 'background' });
  return true;
}

/**
 * What a scheduled message does when it comes due while its session is busy.
 * `interrupt`, the default and upstream's behaviour: it goes out on time,
 * aborting a turn in flight and, when the held process cannot take it,
 * stopping that work. `wait`: it stays scheduled until the turn has ended and,
 * if the held process could not take it, until the work has ended too.
 */
type ScheduledBusyMode = 'interrupt' | 'wait';

function readBusyMode(rawOptions: string): ScheduledBusyMode {
  try {
    return (JSON.parse(rawOptions) as { onBusy?: unknown } | null)?.onBusy === 'wait' ? 'wait' : 'interrupt';
  } catch {
    return 'interrupt';
  }
}

/**
 * `wait` messages the held process has already refused: not pushed again, only
 * sent once the work has ended. In memory, so a restart costs at most one more
 * refused push.
 */
const waitingOutBackgroundWork = new Set<string>();

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

/**
 * Puts every just-claimed `wait` message whose session is busy back to pending,
 * before anyone is told of the claim, and returns the messages still to send.
 */
export function keepWaitingScheduledMessages(rows: ScheduledMessageRow[], runtime: ProviderRuntimeGateway): ScheduledMessageRow[] {
  return rows.filter((row) => {
    if (readBusyMode(row.options) === 'wait' && mustKeepWaiting(row, runtime)) {
      scheduledMessagesDb.releaseClaim(row.id);
      return false;
    }
    return true;
  });
}

/** Back on the banner for a later poll: the claim is undone and open tabs are told. */
function putBack(row: ScheduledMessageRow): null {
  scheduledMessagesDb.releaseClaim(row.id);
  announceScheduledMessagesChanged(row.session_id);
  return null;
}

/**
 * Runs a claimed scheduled message's turn. Returns the result for the caller
 * to record, or null when the message went back to wait.
 *
 * `options` are the message's stored send options; `onBusy` is read here and
 * never reaches the runtime.
 */
export async function runScheduledTurn(
  row: ScheduledMessageRow,
  options: Record<string, unknown>,
  runtime: ProviderRuntimeGateway,
): Promise<DetachedTurnResult | null> {
  const { onBusy: _onBusy, ...turnOptions } = options;
  const busyMode = readBusyMode(row.options);
  const send = (interruptBackground: boolean) => runDetachedChatTurn(
    {
      sessionId: row.session_id,
      userId: row.user_id,
      content: row.content,
      options: turnOptions,
      // The user picked this time on purpose: a run that happens to be going
      // is aborted so the message lands when it was due. A `wait` message was
      // claimed only with no turn in flight, so it never aborts one.
      interruptActiveRun: busyMode === 'interrupt',
      interruptBackground,
    },
    { runtime },
  );

  let result = await send(false);
  if (result.refused) {
    if (busyMode === 'wait') {
      waitingOutBackgroundWork.add(row.id);
      return putBack(row);
    }
    // On time, as upstream sends it: the held process could not take the
    // message, so its background work is stopped and the message sent.
    result = await send(true);
  }

  if (busyMode === 'wait' && !result.started && result.error === 'A run was already in progress for this session.') {
    // A turn started between the check and this send: try again later.
    return putBack(row);
  }

  // Refused even after stopping the work: recorded as failed, never as sent.
  return result.refused && !result.error
    ? { ...result, error: 'The session\'s background work could not be stopped for this message.' }
    : result;
}
