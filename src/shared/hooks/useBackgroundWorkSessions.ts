import { useCallback, useState } from 'react';

import type { MarkSessionBackgroundWork } from '@/shared/types';

/**
 * The sessions holding background work — a backgrounded shell command, a
 * subagent still investigating — after the turn that started it has finished.
 *
 * Deliberately kept apart from the processing map rather than folded into it.
 * The two answer different questions and only one of them may stand in a
 * prompt's way:
 *
 * - processing ("a turn is producing output") blocks a second concurrent turn,
 *   routes the composer to queueing, and suppresses transcript reloads.
 * - this ("work is still alive") must do none of those. Sending the next prompt
 *   is exactly what keeps the work alive — the server hands it to the process it
 *   is already holding open — and the background work keeps writing to the
 *   transcript throughout, so refreshes have to keep happening. All it does is
 *   keep Stop reachable and say so in the UI.
 *
 * The set's identity only changes with its membership, so consumers that merely
 * ask "is this session holding work?" do not re-render on unrelated sessions.
 */
export function useBackgroundWorkSessions() {
  const [backgroundWorkSessionIds, setBackgroundWorkSessionIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const markSessionBackgroundWork = useCallback<MarkSessionBackgroundWork>(
    (sessionId, outstanding) => {
      if (!sessionId) {
        return;
      }

      setBackgroundWorkSessionIds((previous) => {
        if (previous.has(sessionId) === outstanding) {
          return previous;
        }

        const updated = new Set(previous);
        if (outstanding) {
          updated.add(sessionId);
        } else {
          updated.delete(sessionId);
        }
        return updated;
      });
    },
    [],
  );

  return { backgroundWorkSessionIds, markSessionBackgroundWork };
}
