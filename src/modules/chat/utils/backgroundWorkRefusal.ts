type SessionListener = (sessionId: string) => void;

const refusedListeners = new Set<SessionListener>();
const settledListeners = new Set<SessionListener>();

/**
 * Tells the composer that the server refused a send because the session's
 * background work could not be kept, so the message it sent can be answered:
 * put back, or re-sent the way the user then chooses.
 */
export function notifyBackgroundWorkRefused(sessionId: string): void {
  refusedListeners.forEach((listener) => listener(sessionId));
}

export function subscribeBackgroundWorkRefused(listener: SessionListener): () => void {
  refusedListeners.add(listener);
  return () => {
    refusedListeners.delete(listener);
  };
}

/**
 * Tells the composer that a session's run has ended (its `complete` arrived).
 * A refusal always comes before the `complete` of the run it refused, so once
 * this fires the composer's record of what it sent can no longer be refused —
 * and must be dropped, or a later refusal of someone else's send (another tab,
 * a queued message the server sends) would put this old message back.
 */
export function notifyRunSettled(sessionId: string): void {
  settledListeners.forEach((listener) => listener(sessionId));
}

export function subscribeRunSettled(listener: SessionListener): () => void {
  settledListeners.add(listener);
  return () => {
    settledListeners.delete(listener);
  };
}
