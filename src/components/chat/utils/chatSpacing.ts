/**
 * Horizontal breathing room around chat message bubbles on mobile.
 *
 * Only the whitespace *outside* a bubble is tuned here: the message list's
 * centering wrapper (`pane`) and each message row (`row`). The padding inside a
 * bubble is a separate concern and stays untouched. Every level restores the
 * same desktop values at the `sm:` breakpoint, so wide layouts never change.
 */
export const CHAT_SPACING_LEVELS = ['default', 'compact', 'none'] as const;

export type ChatSpacingLevel = (typeof CHAT_SPACING_LEVELS)[number];

export type ChatSpacingClasses = {
  pane: string;
  row: string;
};

export const DEFAULT_CHAT_SPACING_LEVEL: ChatSpacingLevel = 'default';

export const CHAT_SPACING_STORAGE_KEY = 'chatSpacingLevel';

export const CHAT_SPACING_SETTINGS_CHANGED_EVENT = 'chatSpacingSettingsChanged';

const CHAT_SPACING_CLASSES: Record<ChatSpacingLevel, ChatSpacingClasses> = {
  default: { pane: 'px-4', row: 'px-3 sm:px-0' },
  compact: { pane: 'px-2 sm:px-4', row: 'px-1 sm:px-0' },
  none: { pane: 'px-0 sm:px-4', row: 'px-0 sm:px-0' },
};

export const normalizeChatSpacingLevel = (value: unknown): ChatSpacingLevel => (
  CHAT_SPACING_LEVELS.includes(value as ChatSpacingLevel)
    ? (value as ChatSpacingLevel)
    : DEFAULT_CHAT_SPACING_LEVEL
);

export const getChatSpacingClasses = (level: ChatSpacingLevel): ChatSpacingClasses => (
  CHAT_SPACING_CLASSES[level] ?? CHAT_SPACING_CLASSES[DEFAULT_CHAT_SPACING_LEVEL]
);
