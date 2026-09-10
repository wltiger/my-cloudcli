import { useCallback, useState } from 'react';

import { api } from '@/shared/api';
import type { ChatMessage } from '@/shared/types';

type UseSessionForkArgs = {
  /** The session being read. Fork copies this one. */
  sessionId: string | null;
  /** False whenever the action must not be offered at all — unsupported provider, or a run in flight. */
  canFork: boolean;
  /**
   * Whether the provider can be forked through upstream's route, which copies a
   * transcript file up to an anchor. False sends the fork to this fork's own
   * anchor-based route instead.
   *
   * This is the capability, never the provider's name, and it decides the route
   * because a message can carry both Anchor fields at once: OpenCode's Edit
   * anchor rides upstream's `transcriptAnchorId` while its Fork anchor rides
   * this fork's `anchor`, so which field a message carries no longer says which
   * route a fork of it takes.
   */
  usesUpstreamForkRoute: boolean;
  /** Called once the fork exists, to open it and put it in the sidebar. */
  onForked: (forkedSessionId: string, sessionName: string) => void;
  /**
   * Called after a confirmed rename, so the sidebar entry stops showing the
   * name the fork was created under. Deliberately not `onForked` again: that
   * one also navigates, and the reader is already looking at the fork.
   */
  onRenamed: (forkedSessionId: string, sessionName: string) => void;
  /**
   * Shows a failure to the reader, which must never resolve silently. `kind`
   * separates the two steps: a failed fork left nothing behind, while a failed
   * rename left a working fork under the name it was created with.
   */
  onError: (failure: { kind: 'fork' | 'rename'; message: string }) => void;
};

type PendingRename = {
  /** The fork, which already exists by the time this is set. */
  sessionId: string;
  /** The name the box opens pre-filled with. */
  suggestedName: string;
};

/**
 * Owns the Fork gesture end to end: which backend creates the fork, and the
 * naming step that follows it.
 *
 * **Two backends, one gesture.** The branch is taken on whether the provider
 * can be forked through upstream's route, never on the provider's name and
 * never on which Anchor field the chosen message carries:
 *
 * - upstream's fork route copies a transcript file up to `transcriptAnchorId`,
 *   and is the only path for Claude and Codex.
 * - this fork's own anchor-based route rewinds the provider at a computed
 *   `anchor`, which today means OpenCode. Upstream's route requires the source
 *   session to have a transcript file path and OpenCode deliberately stores
 *   none, since all of its sessions share one sqlite database.
 *
 * Keying on the capability is what makes this deletable: a provider upstream
 * reaches later starts reporting it can be forked there and the second branch
 * simply stops being taken, with no code change here.
 *
 * **The naming step runs after the fork exists.** The create call carries no
 * title, so the backend applies its own default; the box that opens next
 * renames the session that is already there. Cancelling therefore issues no
 * request of any kind and leaves the fork under the name the backend gave it —
 * which is what keeps this whole divergence removable by deleting one dialog.
 */
export function useSessionFork({
  sessionId,
  canFork,
  usesUpstreamForkRoute,
  onForked,
  onRenamed,
  onError,
}: UseSessionForkArgs) {
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  const forkFromMessage = useCallback(async (message: ChatMessage) => {
    const sourceSessionId = sessionId;
    const transcriptAnchorId = message.transcriptAnchorId ?? '';
    const anchor = message.anchor ?? '';
    if (!sourceSessionId || (!transcriptAnchorId && !anchor)) {
      return;
    }

    try {
      // No name is sent on purpose: both routes fall back to their own
      // generated default, and the reader names the fork in the box below.
      const response = usesUpstreamForkRoute
        ? await api.forkSession(sourceSessionId, {
            upToAnchorId: transcriptAnchorId || anchor,
          })
        : await api.forkSessionAtAnchor(sourceSessionId, anchor, '');
      const payload = await response.json();
      const forkedSessionId = payload?.data?.sessionId;
      if (!response.ok || typeof forkedSessionId !== 'string') {
        throw new Error(readErrorMessage(payload) || `HTTP ${response.status}`);
      }

      onForked(forkedSessionId, String(payload?.data?.sessionName ?? ''));
      setPendingRename({
        sessionId: forkedSessionId,
        // Read off the source session, whose siblings are what the name is
        // de-duplicated against.
        suggestedName: await fetchSuggestedForkName(sourceSessionId),
      });
    } catch (error) {
      onError({ kind: 'fork', message: readFailureText(error) });
    }
  }, [sessionId, usesUpstreamForkRoute, onForked, onError]);

  const confirmRename = useCallback(async (name: string) => {
    const target = pendingRename;
    const trimmed = name.trim();
    if (!target || !trimmed) {
      return;
    }

    setIsRenaming(true);
    try {
      const response = await api.renameSession(target.sessionId, trimmed);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(readErrorMessage(payload) || `HTTP ${response.status}`);
      }

      setPendingRename(null);
      onRenamed(target.sessionId, trimmed);
    } catch (error) {
      onError({ kind: 'rename', message: readFailureText(error) });
    } finally {
      setIsRenaming(false);
    }
  }, [pendingRename, onRenamed, onError]);

  // Closing the box reaches no endpoint at all — see the note on the hook.
  const cancelRename = useCallback(() => {
    setPendingRename(null);
  }, []);

  return {
    onForkFromMessage: canFork ? forkFromMessage : undefined,
    forkRenameDialogProps: {
      isOpen: pendingRename !== null,
      suggestedName: pendingRename?.suggestedName ?? '',
      isRenaming,
      onConfirm: confirmRename,
      onClose: cancelRename,
    },
  };
}

/**
 * The name the rename box opens pre-filled with: this fork's `[Fork] <name>`
 * convention, de-duplicated by the backend against the names the project has
 * already used — the frontend only holds the first page of them and cannot
 * tell whether one is taken.
 *
 * Never rejects. The fork already exists by the time this runs, so a failed
 * lookup must not read as a failed fork; the box simply opens empty.
 */
async function fetchSuggestedForkName(sessionId: string): Promise<string> {
  try {
    const response = await api.forkSessionName(sessionId);
    const payload = await response.json();
    return String(payload?.data?.suggestedName ?? '');
  } catch (error) {
    console.error('Failed to prepare the fork name:', error);
    return '';
  }
}

/** Reads the message out of the API's `{ success: false, error }` envelope. */
function readErrorMessage(payload: unknown): string {
  const error = (payload as { error?: { message?: unknown } } | null)?.error;
  return typeof error?.message === 'string' ? error.message : '';
}

/** The text shown to the reader for anything thrown above. */
function readFailureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
