import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { readDraftText, writeDraftText } from '@/shared/chatDrafts';
import type {
  BackgroundSendChoice,
  ChatMessage,
  MarkSessionProcessing,
  QueuedDraft,
  QueuedSendOptions,
  SessionActivityMap,
} from '@/shared/types';
import { describeBackgroundTask, ownBackgroundTasks } from '@/modules/chat/utils/backgroundTasks';
import { subscribeBackgroundWorkRefused, subscribeRunSettled } from '@/modules/chat/utils/backgroundWorkRefusal';

/**
 * A sent message as the server received it, kept so a refusal can re-send it
 * (the same frame, now stopping the work) or queue it without uploading its
 * files again. `content` is what the user typed, `messageContent` what was
 * sent (a command's expansion, for instance).
 */
export type RefusableSend = {
  sessionId: string;
  frameType: 'chat.send' | 'chat.edit-send';
  anchorId: string | null;
  content: string;
  messageContent: string;
  files: File[];
  uploadedAttachments: unknown[];
  options: QueuedSendOptions;
};

type RefusedSendComposer = {
  sessionKeyRef: MutableRefObject<string | null>;
  processingSessionsRef: MutableRefObject<SessionActivityMap | undefined>;
  draftScopeRef: MutableRefObject<string | null>;
  inputValueRef: MutableRefObject<string>;
  setInput: (value: string) => void;
  setAttachedFiles: (files: File[]) => void;
  setEditingAnchorId: (anchorId: string | null) => void;
  askBeforeSendingOverBackgroundWork: (work: string[]) => Promise<BackgroundSendChoice>;
  askSideQuestionAndClear: (sessionId: string | null, text: string) => void;
  queueMessage: (draft: QueuedDraft, sessionKey: string | null) => Promise<void>;
  onSessionProcessing?: MarkSessionProcessing;
  sendMessage: (message: unknown) => void;
  addMessage: (message: ChatMessage) => void;
};

/**
 * Answers a send the server refused because the process holding the session's
 * background work could not take it (fork entry 31). This is the one place the
 * background-work dialog opens: the work is still running, and sending now
 * would stop it. The choice acts on the refused message itself, not through
 * the composer's submit — whose own view of the session (just marked
 * processing by the refused send) no longer says "background work".
 *
 * Used by chat's useChatComposerState, which records every send with
 * `recordSend`. The record lives until that run settles: a refusal always
 * arrives before its run's `complete`, and a later one belongs to someone
 * else's send.
 */
export function useRefusedSend(composer: RefusedSendComposer): { recordSend: (sent: RefusableSend) => void } {
  const { t } = useTranslation('chat');
  const lastSentRef = useRef<RefusableSend | null>(null);
  // The listeners below are subscribed once; they read the composer as it is
  // at the moment a refusal arrives.
  const composerRef = useRef(composer);
  useEffect(() => {
    composerRef.current = composer;
  });

  const answerRefusal = useCallback(async (sent: RefusableSend): Promise<void> => {
    const current = composerRef.current;
    if (current.sessionKeyRef.current !== sent.sessionId) {
      // Not the open session: the words go back into that session's own draft
      // (its files cannot be kept there), and nothing is asked.
      const draft = readDraftText(sent.sessionId);
      writeDraftText(sent.sessionId, draft.trim() ? `${sent.content}\n\n${draft}` : sent.content);
      return;
    }

    // Back in the composer as it was sent — an edit still an edit.
    current.setInput(sent.content);
    current.inputValueRef.current = sent.content;
    current.setAttachedFiles(sent.files);
    current.setEditingAnchorId(sent.anchorId);

    const activity = current.processingSessionsRef.current?.get(sent.sessionId);
    const work = ownBackgroundTasks(activity?.tasks ?? []).map((task) => describeBackgroundTask(task, t));
    const choice = await current.askBeforeSendingOverBackgroundWork(work);
    if (choice === 'cancel') {
      return;
    }
    if (choice === 'sideQuestion') {
      current.setEditingAnchorId(null);
      current.askSideQuestionAndClear(sent.sessionId, sent.content);
      return;
    }
    if (choice === 'queue') {
      if (sent.anchorId) {
        // A queued message is sent as a new turn at the end; it cannot replace
        // the message being edited. It stays in the composer, still an edit.
        current.addMessage({
          type: 'error',
          content: t('input.queue.editCannotQueue', {
            defaultValue: 'An edited message cannot be queued: send it once the background work has finished, or choose Send anyway.',
          }),
          timestamp: new Date(),
        });
        return;
      }
      await current.queueMessage({
        content: sent.content,
        attachments: sent.files,
        uploadedAttachments: sent.uploadedAttachments,
        options: sent.options,
        waitFor: 'background',
      }, sent.sessionId);
      return;
    }

    // Send anyway: the same frame again, now stopping the work first. The
    // message is already on screen from the first attempt, so no second echo.
    current.setInput('');
    current.inputValueRef.current = '';
    current.setAttachedFiles([]);
    current.setEditingAnchorId(null);
    if (current.draftScopeRef.current) {
      writeDraftText(current.draftScopeRef.current, '');
    }
    current.onSessionProcessing?.(sent.sessionId, { statusText: null, canInterrupt: true });
    lastSentRef.current = sent;
    current.sendMessage({
      type: sent.frameType,
      sessionId: sent.sessionId,
      ...(sent.anchorId ? { anchorId: sent.anchorId } : {}),
      interruptBackground: true,
      content: sent.messageContent,
      options: {
        ...sent.options,
        attachments: sent.uploadedAttachments,
      },
    });
  }, [t]);

  useEffect(() => subscribeBackgroundWorkRefused((sessionId) => {
    const sent = lastSentRef.current;
    if (!sent || sent.sessionId !== sessionId) {
      return;
    }
    lastSentRef.current = null;
    void answerRefusal(sent);
  }), [answerRefusal]);

  useEffect(() => subscribeRunSettled((sessionId) => {
    if (lastSentRef.current?.sessionId === sessionId) {
      lastSentRef.current = null;
    }
  }), []);

  const recordSend = useCallback((sent: RefusableSend) => {
    lastSentRef.current = sent;
  }, []);

  return { recordSend };
}
