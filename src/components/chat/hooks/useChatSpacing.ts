import { useEffect, useMemo, useState } from 'react';

import {
  CHAT_SPACING_SETTINGS_CHANGED_EVENT,
  CHAT_SPACING_STORAGE_KEY,
  getChatSpacingClasses,
  normalizeChatSpacingLevel,
} from '../utils/chatSpacing';
import type { ChatSpacingClasses } from '../utils/chatSpacing';

const readChatSpacingLevel = () => (
  normalizeChatSpacingLevel(localStorage.getItem(CHAT_SPACING_STORAGE_KEY))
);

/** Mobile-only spacing classes for the message list, live-updated from Settings. */
export const useChatSpacing = (): ChatSpacingClasses => {
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

  return useMemo(() => getChatSpacingClasses(level), [level]);
};
