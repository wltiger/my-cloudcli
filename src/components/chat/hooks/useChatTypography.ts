import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CHAT_TYPOGRAPHY_SETTINGS_CHANGED_EVENT,
  getChatFontClasses,
  getChatWidthClasses,
  readChatFontLevel,
  readChatWidthLevel,
  writeChatFontLevel,
  writeChatWidthLevel,
} from '../utils/chatTypography';
import type {
  ChatFontClasses,
  ChatFontLevel,
  ChatWidthClasses,
  ChatWidthLevel,
} from '../utils/chatTypography';

/**
 * Keeps a stored level in sync with whoever else is editing it — the same level
 * is exposed from Settings and from Quick Settings, and both are often mounted
 * at once, so a change in one has to reach the other without a reload.
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

/**
 * The content column's max width, plus the user bubble's cap. Every surface
 * that spans the column — the message list, the composer, the queued-message
 * card — must use `column`, or they stop lining up with each other.
 */
export const useChatWidthClasses = (): ChatWidthClasses => {
  const [level] = useChatWidthLevel();

  return useMemo(() => getChatWidthClasses(level), [level]);
};
