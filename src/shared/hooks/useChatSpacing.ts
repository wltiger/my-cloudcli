import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CHAT_SPACING_SETTINGS_CHANGED_EVENT,
  getChatSpacingClasses,
  readChatSpacingLevel,
  writeChatSpacingLevel,
} from '@/shared/chatSpacing';
import type { ChatSpacingClasses, ChatSpacingLevel } from '@/shared/chatSpacing';

/**
 * The stored spacing level plus a setter that persists it. Every surface that
 * edits the level (Settings, Quick Settings) shares this hook, so a change in
 * one is picked up by the others without a reload.
 *
 * Shared rather than chat-module-owned because three modules use it — and
 * because reaching it through the chat barrel makes any importer evaluate
 * `ChatInterface`'s whole tree (xterm included). See fork customization #3.
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
