import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { ServerEvent,MarkSessionBackgroundWork,MarkSessionIdle,MarkSessionProcessing,PendingPermissionRequest,ProjectSession,LLMProvider,NormalizedMessage,GetSessionActivity,MarkSessionBackground } from '@/shared/types';
import { notifyBackgroundWorkRefused } from '@/modules/chat/utils/backgroundWorkRefusal';
import { showCompletionTitleIndicator } from '@/modules/chat/utils/pageTitleNotification';
import { playChatCompletionSound, playNotificationSound } from '@/shared/utils';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import { collectRunningBackgroundTasks } from '@/modules/chat/utils/backgroundTasks';

const isActionablePermissionRequest = (request: { toolName?: unknown } | null | undefined): boolean => {
  return request?.toolName !== 'ExitPlanMode' && request?.toolName !== 'exit_plan_mode';
};

const hasActionablePermissionRequests = (requests: Array<{ toolName?: unknown }> | null | undefined): boolean => {
  return Array.isArray(requests) && requests.some((request) => isActionablePermissionRequest(request));
};

type UseChatRealtimeHandlersArgs = {
  isActive: boolean;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  provider: LLMProvider;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  pendingPermissionRequests: PendingPermissionRequest[];
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  /**
   * Pending stream flush per session. One shared timer meant a second session
   * streaming at the same time found it already set and never flushed its own.
   */
  streamTimerRef: MutableRefObject<Map<string, number>>;
  /** Text streamed per session since that session's last `stream_end`. */
  accumulatedStreamRef: MutableRefObject<Map<string, string>>;
  /**
   * Highest live `seq` observed per session. Essential for reconnect catch-up:
   * `chat.subscribe` sends this value as `lastSeq` so the server replays only
   * the events this client actually missed. Written here on every sequenced
   * frame; read wherever a `chat.subscribe` is sent (session open, reconnect).
   */
  lastSeqRef: MutableRefObject<Map<string, number>>;
  /** When each session's `chat.subscribe` was last sent; guards stale idle acks. */
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  /**
   * Records whether a session still holds work that outlives its turn. Separate
   * from `onSessionProcessing`/`onSessionIdle` on purpose: a session can be
   * idle and still holding work, which is precisely the state that must keep
   * Stop available without keeping the next prompt out.
   */
  onSessionBackgroundWork?: MarkSessionBackgroundWork;
  /** Reports the tasks a session still runs once its turn ends, so it reads as background work rather than idle. */
  onSessionBackground?: MarkSessionBackground;
  getSessionActivity?: GetSessionActivity;
  onWebSocketReconnect?: () => void;
  requestLatestMessages: (sessionId: string, allowNetwork?: boolean) => Promise<void>;
  sessionStore: SessionStore;
};

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

/**
 * Routes server events into the session store and processing-state map.
 *
 * This is intentionally a thin reducer over the unified `kind`-based
 * protocol: every frame is keyed by the stable app session id, so there is
 * no session-id handoff, no provider branching, and no navigation here.
 * Sidebar events (`session_upserted`, `loading_progress`) are handled by
 * `useProjectsState`, not in this hook.
 */
export function useChatRealtimeHandlers({
  isActive,
  subscribe,
  provider,
  selectedSession,
  currentSessionId,
  setTokenBudget,
  pendingPermissionRequests,
  setPendingPermissionRequests,
  streamTimerRef,
  accumulatedStreamRef,
  lastSeqRef,
  statusCheckSentAtRef,
  onSessionProcessing,
  onSessionIdle,
  onSessionBackgroundWork,
  onSessionBackground,
  getSessionActivity,
  onWebSocketReconnect,
  requestLatestMessages,
  sessionStore,
}: UseChatRealtimeHandlersArgs) {
  // Session switches can send `chat.subscribe` before this effect has a chance
  // to rebind the websocket listener. Read the visible session id from a ref
  // so a fast `chat_subscribed` ack is matched against the current view, not
  // the previous render's closed-over selection.
  const activeViewSessionIdRef = useRef<string | null>(selectedSession?.id || currentSessionId || null);
  activeViewSessionIdRef.current = selectedSession?.id || currentSessionId || null;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // Keep the latest pending-permission snapshot available to the websocket
  // listener so back-to-back permission events can dedupe and re-arm the
  // notification sound before React finishes a rerender.
  const pendingPermissionRequestsRef = useRef(pendingPermissionRequests);

  useEffect(() => {
    pendingPermissionRequestsRef.current = pendingPermissionRequests;
  }, [pendingPermissionRequests]);

  useEffect(() => {
    // Cancels a session's pending flush and hands back the text it buffered.
    const takeBufferedStream = (sessionId: string): string => {
      clearTimeout(streamTimerRef.current.get(sessionId));
      streamTimerRef.current.delete(sessionId);
      const buffered = accumulatedStreamRef.current.get(sessionId) ?? '';
      accumulatedStreamRef.current.delete(sessionId);
      return buffered;
    };

    // What a session that has finished responding is left with: the tasks it
    // launched that are still running, or nothing, which marks it idle. The
    // store's records are what the transcript's cards fold their live status
    // from, so this reads the same answer they draw.
    const reportRemainingBackgroundWork = (sid: string) => {
      onSessionBackground?.(sid, collectRunningBackgroundTasks(normalizedToChatMessages(sessionStore.getMessages(sid))));
    };

    const handleEvent = (msg: ServerEvent) => {
      if (!msg.kind) {
        return;
      }

      const activeViewSessionId = activeViewSessionIdRef.current;
      const sid = (typeof msg.sessionId === 'string' && msg.sessionId) || activeViewSessionId;

      // Record replay progress for every sequenced live event.
      if (sid && typeof msg.seq === 'number') {
        const known = lastSeqRef.current.get(sid) ?? 0;
        if (msg.seq > known) {
          lastSeqRef.current.set(sid, msg.seq);
        }
      }

      switch (msg.kind) {
        case 'websocket_reconnected':
          onWebSocketReconnect?.();
          return;

        case 'history_truncated': {
          // An already-sent message was replaced. Every client watching this
          // session drops the superseded turns before the replacement streams
          // in, so a second tab does not end up showing the question twice.
          if (sid && typeof msg.anchorId === 'string') {
            sessionStore.truncateAt(sid, msg.anchorId);
          }
          return;
        }

        case 'session_background_work': {
          // Work that outlives a turn started or finished. Broadcast to every
          // client rather than to a run's audience, because the state routinely
          // flips after the run that started it has already ended.
          if (sid) {
            onSessionBackgroundWork?.(sid, msg.outstanding === true);
          }
          return;
        }

        case 'chat_subscribed': {
          // Ack for chat.subscribe: authoritative processing state plus any
          // pending tool-permission prompts for the run.
          if (!sid) return;

          // The ack is the only place a client that was away (reload, dropped
          // socket) learns about a hold whose delta it missed.
          onSessionBackgroundWork?.(sid, msg.backgroundWorkOutstanding === true);

          if (msg.isProcessing) {
            onSessionProcessing?.(sid);
          } else {
            // Idle ack: ignore it if a newer request started after the
            // subscribe was sent — the ack describes the older state.
            onSessionIdle?.(sid, {
              ifStartedBefore: statusCheckSentAtRef.current.get(sid),
            });
          }

          const isViewedSession = sid === activeViewSessionId;
          if (isViewedSession && Array.isArray(msg.pendingPermissions)) {
            const nextPendingPermissionRequests = msg.pendingPermissions as PendingPermissionRequest[];
            const hadActionablePermissionRequests = hasActionablePermissionRequests(pendingPermissionRequestsRef.current);
            const hasPendingActionablePermissionRequests = hasActionablePermissionRequests(nextPendingPermissionRequests);

            pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
            setPendingPermissionRequests(nextPendingPermissionRequests);

            if (hasPendingActionablePermissionRequests && !hadActionablePermissionRequests) {
              void playNotificationSound();
            }
          }
          return;
        }

        case 'protocol_error': {
          console.error('[Chat] Protocol error:', msg.code, msg.error);
          if (sid) {
            // Surface the failure in the conversation and stop the spinner —
            // the run never started (or was rejected), so no `complete` follows.
            // A refused stop request is not about the run: the task had
            // already settled, and idling here would drop a response in
            // flight on that session.
            if (msg.code !== 'NO_SUCH_TASK' && msg.code !== 'TASK_ID_REQUIRED') {
              onSessionIdle?.(sid);
            }
            sessionStore.appendRealtime(sid, {
              id: `protocol_error_${Date.now()}`,
              sessionId: sid,
              timestamp: new Date().toISOString(),
              provider,
              kind: 'error',
              content: String(msg.error || 'Request failed'),
            } as NormalizedMessage);
          }
          return;
        }

        // Sidebar/global events — owned by useProjectsState.
        case 'session_upserted':
        case 'loading_progress':
          return;

        default:
          break;
      }

      /* -------------------------------------------------------------- */
      /*  Provider NormalizedMessage handling                            */
      /* -------------------------------------------------------------- */

      // The server refused a send that could not join the background work it
      // would have had to stop. The error row below still shows why; this also
      // gives the typed message back to the composer.
      if (msg.kind === 'error' && msg.code === 'background_work_not_kept' && msg.sessionId) {
        notifyBackgroundWorkRefused(msg.sessionId);
      }

      // --- Streaming: buffer per session for performance ---
      // Viewed or not, a session's text reaches the store the same way: its
      // own buffer, flushed by its own timer into its streaming row. Appending
      // raw deltas for background sessions instead gave them one row per chunk.
      if (msg.kind === 'stream_delta') {
        const text = (msg.content as string) || '';
        if (!text || !sid) return;
        accumulatedStreamRef.current.set(sid, (accumulatedStreamRef.current.get(sid) ?? '') + text);
        if (!streamTimerRef.current.has(sid)) {
          streamTimerRef.current.set(sid, window.setTimeout(() => {
            streamTimerRef.current.delete(sid);
            sessionStore.updateStreaming(sid, accumulatedStreamRef.current.get(sid) ?? '', provider);
          }, 100));
        }
        return;
      }

      if (msg.kind === 'stream_end') {
        if (sid) {
          const buffered = takeBufferedStream(sid);
          if (buffered) {
            sessionStore.updateStreaming(sid, buffered, provider);
          }
          sessionStore.finalizeStreaming(sid);
        }
        return;
      }

      // --- All other messages: route to store ---
      const shouldPersist =
        msg.kind !== 'complete'
        && msg.kind !== 'status'
        && msg.kind !== 'permission_request'
        && msg.kind !== 'permission_resolved'
        && msg.kind !== 'permission_cancelled';

      if (sid && shouldPersist) {
        sessionStore.appendRealtime(sid, msg as unknown as NormalizedMessage);
      }

      // --- UI side effects for specific kinds ---
      switch (msg.kind) {
        case 'complete': {
          // Flush any remaining streaming state
          if (sid) {
            const buffered = takeBufferedStream(sid);
            if (buffered) {
              sessionStore.updateStreaming(sid, buffered, provider);
              sessionStore.finalizeStreaming(sid);
            }
          }

          // `complete` is the unified terminal event — every provider run ends
          // with exactly one, regardless of success, failure, or abort. The
          // indicator derives from the processing map, so the entry changes
          // immediately and atomically: a turn that ended with tasks still
          // running leaves the session as background work — the CLI is held
          // open for them — and any other leaves it idle. An abort releases
          // the CLI and takes that work down with it.
          if (sid && !msg.aborted) {
            reportRemainingBackgroundWork(sid);
          } else {
            onSessionIdle?.(sid);
          }
          if (sid === activeViewSessionId) {
            pendingPermissionRequestsRef.current = [];
            setPendingPermissionRequests([]);
          }

          if (msg.aborted) {
            // Abort was requested — the complete event confirms it. No
            // further UI action is needed beyond clearing the entry above.
            break;
          }

          // Celebrate only successful runs (failed runs end with success: false).
          if (msg.success !== false) {
            showCompletionTitleIndicator();
            void playChatCompletionSound();
          }

          // The session id is stable for the whole conversation (allocated
          // before the first send), so the only follow-up is syncing the
          // viewed conversation with the now-persisted transcript.
          if (sid && sid === activeViewSessionId) {
            void requestLatestMessages(sid, isActiveRef.current);
          }

          break;
        }

        // 'error' is an informational message row, not a terminal event —
        // providers emit it for mid-run stderr output too. Run teardown is
        // always signalled by the unified 'complete' that follows.

        case 'permission_request': {
          if (!msg.requestId) break;
          if (isActionablePermissionRequest({ toolName: msg.toolName })) {
            void playNotificationSound();
          }

          if (sid === activeViewSessionId) {
            const previousPendingPermissionRequests = pendingPermissionRequestsRef.current;
            if (!previousPendingPermissionRequests.some((request) => request.requestId === msg.requestId)) {
              const nextPendingPermissionRequests = [...previousPendingPermissionRequests, {
                requestId: msg.requestId as string,
                toolName: (msg.toolName as string) || 'UnknownTool',
                input: msg.input,
                context: msg.context,
                sessionId: sid || null,
                receivedAt: new Date(),
              }];

              pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
              setPendingPermissionRequests(nextPendingPermissionRequests);
            }
          }
          if (sid) {
            onSessionProcessing?.(sid);
          }
          break;
        }

        // `permission_resolved` arrives when any client answers the prompt: it
        // retracts a replayed `permission_request` after a mid-run refresh and
        // clears the prompt in other tabs watching the same run.
        case 'permission_resolved':
        case 'permission_cancelled': {
          if (msg.requestId && sid === activeViewSessionId) {
            const nextPendingPermissionRequests = pendingPermissionRequestsRef.current.filter(
              (request: PendingPermissionRequest) => request.requestId !== msg.requestId,
            );

            pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
            setPendingPermissionRequests(nextPendingPermissionRequests);
          }
          break;
        }

        case 'status': {
          if (msg.text === 'token_budget' && msg.tokenBudget) {
            // The counter shows the viewed session's context; budgets from
            // other concurrently running sessions must not overwrite it.
            if (sid === activeViewSessionId) {
              setTokenBudget(msg.tokenBudget as Record<string, unknown>);
            }
          } else if (msg.text && sid) {
            onSessionProcessing?.(sid, {
              statusText: msg.text as string,
              canInterrupt: msg.canInterrupt !== false,
            });
          }
          break;
        }

        case 'task_status': {
          // A task's notification, or the patch that killed it, can leave a
          // session that was only doing background work with nothing left
          // to do. A turn in flight is left alone: its `complete` reports.
          if (
            sid
            && (msg.event === 'notification' || msg.event === 'updated')
            && getSessionActivity?.(sid)?.background
          ) {
            reportRemainingBackgroundWork(sid);
          }
          // The notification carries only a summary; the task's actual result
          // is folded onto its card by the history reader, so a card that
          // just settled live shows it only after a sync — the same sync a
          // turn's `complete` triggers. Without it the result waited for a
          // manual reload.
          if (sid && sid === activeViewSessionId && msg.event === 'notification') {
            void requestLatestMessages(sid, isActiveRef.current);
          }
          break;
        }

        // text, tool_use, tool_result, thinking, task_notification
        // → already routed to store above, no UI side effects needed
        default:
          break;
      }
    };

    return subscribe(handleEvent);
  }, [
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onSessionBackgroundWork,
    onSessionBackground,
    getSessionActivity,
    onWebSocketReconnect,
    requestLatestMessages,
    sessionStore,
  ]);
}
