import { useCallback, useState } from 'react';

import { api } from '../../../utils/api';

type UseSessionForkArgs = {
  /** The session being read. Fork copies this one. */
  sessionId: string | null;
  /** False whenever the action must not be offered at all — unsupported provider, or a run in flight. */
  canFork: boolean;
  /** Called with the new session id once the fork exists, to switch the UI to it. */
  onForked: (forkedSessionId: string, sessionName: string) => void;
};

/**
 * Owns the Fork gesture: picking a message, naming the fork, creating it.
 *
 * `onForkMessage` is `undefined` when Fork is unavailable, so message rows can
 * pass it straight through and simply render no entry — the alternative, a
 * disabled button, would advertise an action the session cannot perform.
 */
export function useSessionFork({ sessionId, canFork, onForked }: UseSessionForkArgs) {
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [suggestedName, setSuggestedName] = useState('');
  const [isForking, setIsForking] = useState(false);

  // The suggested name is fetched before the dialog opens rather than after, so
  // the input is never briefly empty and never briefly shows a taken name.
  const openFork = useCallback(async (anchor: string) => {
    if (!sessionId) {
      return;
    }

    try {
      const response = await api.forkSessionName(sessionId);
      const payload = await response.json();
      setSuggestedName(payload?.data?.suggestedName || '');
      setPendingAnchor(anchor);
    } catch (error) {
      console.error('Failed to prepare fork:', error);
    }
  }, [sessionId]);

  const closeFork = useCallback(() => {
    setPendingAnchor(null);
  }, []);

  const confirmFork = useCallback(async (name: string) => {
    if (!sessionId || !pendingAnchor) {
      return;
    }

    setIsForking(true);
    try {
      const response = await api.forkSession(sessionId, pendingAnchor, name);
      const payload = await response.json();
      if (!response.ok || !payload?.data?.sessionId) {
        throw new Error(payload?.error?.message || 'Fork failed');
      }

      setPendingAnchor(null);
      onForked(payload.data.sessionId, payload.data.sessionName);
    } catch (error) {
      console.error('Failed to fork session:', error);
    } finally {
      setIsForking(false);
    }
  }, [sessionId, pendingAnchor, onForked]);

  return {
    onForkMessage: canFork ? openFork : undefined,
    forkDialogProps: {
      isOpen: pendingAnchor !== null,
      suggestedName,
      isForking,
      onConfirm: confirmFork,
      onClose: closeFork,
    },
  };
}
