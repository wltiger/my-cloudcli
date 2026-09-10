import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CHAT_TYPOGRAPHY_SETTINGS_CHANGED_EVENT,
  getChatFontClasses,
  getChatWidthClasses,
  readChatFontLevel,
  readChatWidthLevel,
  writeChatFontLevel,
  writeChatWidthLevel,
} from '@/shared/chatTypography';
import type {
  ChatFontClasses,
  ChatFontLevel,
  ChatWidthClasses,
  ChatWidthLevel,
} from '@/shared/chatTypography';

/**
 * Keeps a stored level in sync with whoever else is editing it — the same level
 * is exposed from Settings and from Quick Settings, and both are often mounted
 * at once, so a change in one has to reach the other without a reload.
 *
 * These hooks are shared rather than chat-module-owned because three modules use
 * them — and because reaching them through the chat barrel makes any importer
 * evaluate `ChatInterface`'s whole tree (xterm included). See fork customization #3.
 */
const useStoredLevel = <T,>(read: () => T, write: (level: T) => void): [T, (level: T) => void] => {
  const [level, setLevel] = useState(read);

  useEffect(() => {
    const refreshFromStorage = () => setLevel(read());

    window.addEventListener('storage', refreshFromStorage);
    window.addEventListener(CHAT_TYPOGRAPHY_SETTINGS_CHANGED_EVENT, refreshFromStorage);

    return () => {
      window.removeEventListener('storage', refreshFromStorage);
      window.removeEventListener(CHAT_TYPOGRAPHY_SETTINGS_CHANGED_EVENT, refreshFromStorage);
    };
  }, [read]);

  const updateLevel = useCallback((next: T) => {
    setLevel(next);
    write(next);
  }, [write]);

  return [level, updateLevel];
};

/** The stored reading-text size plus a setter that persists it. */
export const useChatFontLevel = (): [ChatFontLevel, (level: ChatFontLevel) => void] => (
  useStoredLevel(readChatFontLevel, writeChatFontLevel)
);

/** The stored content-column width plus a setter that persists it. */
export const useChatWidthLevel = (): [ChatWidthLevel, (level: ChatWidthLevel) => void] => (
  useStoredLevel(readChatWidthLevel, writeChatWidthLevel)
);

/** Size classes for the chat's reading text, live-updated from Settings. */
export const useChatFontClasses = (): ChatFontClasses => {
  const [level] = useChatFontLevel();

  return useMemo(() => getChatFontClasses(level), [level]);
};

const PROSE_PATTERN = /\bprose\b/;
const PROSE_SIZE_PATTERN = /\bprose-(sm|base|lg|xl|2xl)\b/;

/**
 * A prose container's className with the reader's chosen size folded in. Every
 * markdown body in the chat sizes itself from the level, so call sites name no
 * prose size at all; one that does — the fullscreen reader, deliberately larger
 * than the message stream — keeps what it asked for.
 *
 * Both prose containers in the transcript go through here: `Markdown` and
 * `StreamingMarkdown`, which renders its own container rather than `Markdown`'s.
 */
export const useChatProseClassName = (className?: string): string | undefined => {
  const fontClasses = useChatFontClasses();

  return useMemo(() => {
    if (!className || !PROSE_PATTERN.test(className) || PROSE_SIZE_PATTERN.test(className)) {
      return className;
    }

    return `${className} ${fontClasses.prose}`;
  }, [className, fontClasses.prose]);
};

/**
 * The content column's max width, plus the user bubble's cap. Every surface
 * that spans the column — the message list, the composer, the queued-message
 * card — must use `column`, or they stop lining up with each other.
 */
export const useChatWidthClasses = (): ChatWidthClasses => {
  const [level] = useChatWidthLevel();

  return useMemo(() => getChatWidthClasses(level), [level]);
};
