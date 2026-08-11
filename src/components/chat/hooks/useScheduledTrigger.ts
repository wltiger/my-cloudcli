import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../utils/api';

export type ScheduledTrigger = {
  id: number;
  sessionId: string;
  triggerAt: string;
  messageContent: string;
  status: string;
  createdAt: string;
  firedAt: string | null;
  error: string | null;
};

/** Tracks (and lets the user create/cancel) the one pending scheduled trigger for a session. */
export function useScheduledTrigger(sessionId: string | null | undefined) {
  const [pendingTrigger, setPendingTrigger] = useState<ScheduledTrigger | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setPendingTrigger(null);
      return;
    }

    try {
      const response = await api.listScheduledTriggers(sessionId);
      const data = await response.json();
      const triggers: ScheduledTrigger[] = data.triggers || [];
      setPendingTrigger(triggers.find((trigger) => trigger.status === 'pending') ?? null);
    } catch {
      // Best-effort: leave whatever state we already had if the fetch fails.
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const schedule = useCallback(async (triggerAt: Date, messageContent: string): Promise<void> => {
    if (!sessionId) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.createScheduledTrigger(sessionId, triggerAt.toISOString(), messageContent);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to schedule trigger');
      }
      await refresh();
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, refresh]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!pendingTrigger) {
      return;
    }

    setIsLoading(true);
    try {
      await api.cancelScheduledTrigger(pendingTrigger.id);
      await refresh();
    } finally {
      setIsLoading(false);
    }
  }, [pendingTrigger, refresh]);

  return { pendingTrigger, isLoading, schedule, cancel };
}
