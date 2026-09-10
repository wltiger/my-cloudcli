import { useCallback } from 'react';

import { api } from '@/shared/api';

type UseSessionClearArgs = {
  /** The conversation being read. Clear retires this one. */
  sessionId: string | null;
  /** Called with the empty session that takes over and the conversation it retired. */
  onCleared: (openedSessionId: string, retiredSessionId: string) => void;
};

/**
 * Owns the Clear gesture: retiring the open conversation and continuing in an
 * empty one.
 *
 * Nothing is confirmed first, because Clear removes nothing — the retired
 * conversation keeps every message and stays readable from the archived view,
 * and resuming it un-archives it again.
 */
export function useSessionClear({ sessionId, onCleared }: UseSessionClearArgs) {
  return useCallback(async () => {
    // A conversation that was never started has nothing to retire.
    if (!sessionId) {
      return;
    }

    try {
      const response = await api.clearSession(sessionId);
      const payload = await response.json();
      if (!response.ok || !payload?.data?.sessionId) {
        throw new Error(payload?.error?.message || 'Clear failed');
      }

      // No name is passed for the empty session on purpose: it stays unnamed
      // until its first message gives it a title, like any brand-new chat.
      onCleared(payload.data.sessionId, payload.data.retiredSessionId);
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  }, [sessionId, onCleared]);
}
