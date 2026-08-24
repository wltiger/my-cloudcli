import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChatAttachment, ChatImage, ChatMessage } from '../types/types';
import { authenticatedFetch } from '../../../utils/api';

/**
 * Rewind: re-sending an earlier message so the session continues from that
 * point, under the same session id, with everything after it gone from context
 * but not deleted.
 *
 * The shape of this hook is decided by ADR 0006: `resumeSessionAt` is an option
 * on the *next* query, not an operation, so there is deliberately no "rewound
 * but not sent" state to persist. Choosing Rewind only loads the message back
 * into the composer, dims what follows and shows a notice — pressing send is
 * what performs it. A reload therefore cancels a Rewind that was never sent,
 * which is correct rather than a gap.
 *
 * Holds no per-provider rule: an Anchor is an opaque token the backend put on
 * the message, and whether the provider can rewind at all is a capability flag.
 */

/** The message being re-sent, held until send or cancel. */
export type RewindDraft = {
  /** Opaque provider Anchor: the transcript row the resumed context ends at. */
  anchor: string;
  content: string;
  images: ChatImage[];
  files: ChatAttachment[];
};

export function useSessionRewind({
  sessionId,
  canRewind,
  chatMessages,
}: {
  sessionId: string | null;
  /** False whenever Rewind must not be offered: unsupported provider, or a run in flight. */
  canRewind: boolean;
  chatMessages: ChatMessage[];
}) {
  const [rewindDraft, setRewindDraft] = useState<RewindDraft | null>(null);

  // Drops the pending Rewind and leaves the composer exactly as it is. This is
  // the *send* path: the send already spent the draft and emptied the composer,
  // so handing anything back would refill it. Backing out is a different
  // function — `useRewindComposerPrefill` wraps this one to restore too.
  const clearRewind = useCallback(() => {
    setRewindDraft(null);
  }, []);

  // An Anchor belongs to one session's transcript. Carrying a draft across a
  // session switch would hand the next session a uuid it cannot resolve.
  useEffect(() => {
    setRewindDraft(null);
  }, [sessionId]);

  const beginRewind = useCallback((anchor: string) => {
    const message = chatMessages.find((candidate) => candidate.rewindAnchor === anchor);
    if (!message) {
      return;
    }
    setRewindDraft({
      anchor,
      content: typeof message.content === 'string' ? message.content : '',
      images: Array.isArray(message.images) ? message.images : [],
      files: Array.isArray(message.files) ? message.files : [],
    });
  }, [chatMessages]);

  // The chosen message and everything after it: what leaves the context on send.
  const rewindDimmedMessages = useMemo(() => {
    if (!rewindDraft) {
      return null;
    }
    const index = chatMessages.findIndex(
      (candidate) => candidate.rewindAnchor === rewindDraft.anchor,
    );
    return index < 0 ? null : new Set(chatMessages.slice(index));
  }, [rewindDraft, chatMessages]);

  return {
    /** Undefined hides the per-message entry entirely, the same way Fork's does. */
    onRewindMessage: canRewind ? beginRewind : undefined,
    rewindDraft,
    rewindAnchor: rewindDraft?.anchor ?? null,
    rewindDimmedMessages,
    rewindLeavingCount: rewindDimmedMessages?.size ?? 0,
    clearRewind,
  };
}

/**
 * Loads a Rewind draft into the composer.
 *
 * Split from `useSessionRewind` purely because of hook ordering: the draft has
 * to exist before `useChatComposerState` runs so its Anchor can ride along with
 * the send, while the setters it writes through only exist afterwards.
 *
 * Attachments are restored alongside the text on purpose — a Rewind that
 * silently drops the message's image is worse than no Rewind, since "the image
 * was wrong, let me resend it" is a main reason to reach for this.
 *
 * Taking the composer over is destructive, so what it held first is saved and
 * handed back when the Rewind is backed out of: a reader half-way through
 * typing can look at an earlier message, change their mind, press Esc, and
 * still have their own draft. Only **cancel** restores — a send has already
 * spent the draft, and putting the old text back afterwards would refill a
 * composer the send just emptied. Nothing is persisted, so a reload cancels a
 * never-sent Rewind without restoring anything (ADR 0006).
 */
export function useRewindComposerPrefill({
  rewindDraft,
  clearRewind,
  input,
  attachedFiles,
  setComposerDraft,
  setAttachedFiles,
}: {
  rewindDraft: RewindDraft | null;
  clearRewind: () => void;
  input: string;
  attachedFiles: File[];
  setComposerDraft: (value: string) => void;
  setAttachedFiles: (files: File[]) => void;
}) {
  // The composer's live contents, readable from the effects below without
  // making them re-run on every keystroke (which would re-apply the draft).
  const composerRef = useRef({ input, attachedFiles });
  useEffect(() => {
    composerRef.current = { input, attachedFiles };
  }, [input, attachedFiles]);

  const savedComposerRef = useRef<{ input: string; attachedFiles: File[] } | null>(null);

  useEffect(() => {
    if (!rewindDraft) {
      return;
    }

    // Read before the writes below: on the render that starts a Rewind the
    // composer still holds the reader's own draft.
    savedComposerRef.current = composerRef.current;
    setComposerDraft(rewindDraft.content);

    let cancelled = false;
    void restoreRewindAttachments(rewindDraft).then((files) => {
      if (!cancelled) {
        // Set even when empty: rewinding to a message that had no attachments
        // must drop whatever the composer was holding, or they ride along.
        setAttachedFiles(files);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rewindDraft, setComposerDraft, setAttachedFiles]);

  // Backing out: drop the pending Rewind and hand the composer back. Done in
  // the click/key handler rather than in an effect keyed on the draft going
  // away, because *sending* also makes it go away and must not restore.
  return useCallback(() => {
    const saved = savedComposerRef.current;
    savedComposerRef.current = null;
    clearRewind();
    if (saved) {
      setComposerDraft(saved.input);
      setAttachedFiles(saved.attachedFiles);
    }
  }, [clearRewind, setComposerDraft, setAttachedFiles]);
}

/**
 * Rebuilds the composer's `File` objects from a history message's attachments.
 * Anything that cannot be rebuilt is skipped rather than failing the Rewind.
 */
async function restoreRewindAttachments(draft: RewindDraft): Promise<File[]> {
  const restored = await Promise.all([
    ...draft.images.map((image, index) => restoreAttachmentFile(
      image,
      'images',
      `rewind-image-${index + 1}.png`,
    )),
    ...draft.files.map((file) => restoreAttachmentFile(file, 'files', 'rewind-attachment')),
  ]);
  return restored.filter((file): file is File => file !== null);
}

async function restoreAttachmentFile(
  attachment: ChatImage,
  assetKind: 'images' | 'files',
  fallbackName: string,
): Promise<File | null> {
  const storedName = attachment.path?.split(/[\\/]/).pop() || '';
  const name = attachment.name || storedName || fallbackName;

  try {
    // Claude persists a user turn's images inline as base64, so the common case
    // needs no network at all; `fetch` reads a data URL directly.
    const response = attachment.data
      ? await fetch(attachment.data)
      : storedName
        ? await authenticatedFetch(`/api/assets/${assetKind}/${encodeURIComponent(storedName)}`)
        : null;
    if (!response?.ok) {
      return null;
    }
    const blob = await response.blob();
    return new File([blob], name, { type: attachment.mimeType || blob.type || undefined });
  } catch {
    return null;
  }
}
