import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { BackgroundWorkEvent } from '@/shared/types.js';

/**
 * The single producer of the `session_background_work` delta.
 *
 * A session can hold work that outlives the turn that started it — a
 * backgrounded shell command, a subagent still investigating — and that state is
 * deliberately *not* the same thing as "a turn is producing output right now"
 * (which the run registry's `status` already carries, and which every client
 * learns from the terminal `complete`). Collapsing the two would either block
 * the follow-up prompt the held process exists to accept, or hide from the user
 * that their work is still alive.
 *
 * So it gets its own frame. It is broadcast to every connected chat client
 * rather than to the originating run's audience because the state routinely
 * flips *after* that run has finished and been evicted, and because a session
 * open in a second tab has to agree about it.
 */
export function broadcastBackgroundWork(sessionId: string, outstanding: boolean): void {
  if (!sessionId) {
    return;
  }

  const event: BackgroundWorkEvent = {
    kind: 'session_background_work',
    sessionId,
    outstanding,
    timestamp: new Date().toISOString(),
  };
  const payload = JSON.stringify(event);

  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
}
