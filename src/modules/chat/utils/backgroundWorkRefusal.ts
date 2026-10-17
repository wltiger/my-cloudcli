type BackgroundWorkRefusedListener = (sessionId: string) => void;

const listeners = new Set<BackgroundWorkRefusedListener>();

/**
 * Tells the composer that the server refused a send because the session's
 * background work could not be kept, so the typed message should come back.
 */
export function notifyBackgroundWorkRefused(sessionId: string): void {
  listeners.forEach((listener) => listener(sessionId));
}

export function subscribeBackgroundWorkRefused(listener: BackgroundWorkRefusedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
