import { useEffect } from 'react';

/**
 * Clears a session's stacked-up push notifications from the phone's
 * notification center as soon as that session is opened.
 *
 * Notifications are collapsed one-per-session by tag, but the tag path can be
 * bypassed (iOS Safari never replaces a same-tag notification on its own), so
 * the service worker also closes them on demand — see `closeSessionNotifications`
 * in `public/sw.js`.
 */
export function useClearSessionNotifications(sessionId: string | undefined) {
  useEffect(() => {
    if (!sessionId || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_SESSION_NOTIFICATIONS', sessionId });
  }, [sessionId]);
}
