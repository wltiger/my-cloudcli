import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CHAT_SPACING_SETTINGS_CHANGED_EVENT,
  getChatSpacingClasses,
  readChatSpacingLevel,
  writeChatSpacingLevel,
} from '../utils/chatSpacing';
import type { ChatSpacingClasses, ChatSpacingLevel } from '../utils/chatSpacing';

/**
 * The stored spacing level plus a setter that persists it. Every surface that
 * edits the level (Settings, Quick Settings) shares this hook, so a change in
 * one is picked up by the others without a reload.
 */
export const useChatSpacingLevel = (): [ChatSpacingLevel, (level: ChatSpacingLevel) => void] => {
  const [level, setLevel] = useState(readChatSpacingLevel);

  useEffect(() => {
    const refreshFromStorage = () => setLevel(readChatSpacingLevel());

    window.addEventListener('storage', refreshFromStorage);
    window.addEventListener(CHAT_SPACING_SETTINGS_CHANGED_EVENT, refreshFromStorage);

    return () => {
      window.removeEventListener('storage', refreshFromStorage);
      window.removeEventListener(CHAT_SPACING_SETTINGS_CHANGED_EVENT, refreshFromStorage);
    };
  }, []);

  const updateLevel = useCallback((next: ChatSpacingLevel) => {
    setLevel(next);
    writeChatSpacingLevel(next);
  }, []);

  return [level, updateLevel];
};

/** Mobile-only spacing classes for the message list, live-updated from Settings. */
export const useChatSpacing = (): ChatSpacingClasses => {
  const [level] = useChatSpacingLevel();

  return useMemo(() => getChatSpacingClasses(level), [level]);
};
