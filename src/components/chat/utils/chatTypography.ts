/**
 * How large the chat's reading text is, and how wide the content column runs.
 *
 * "Reading text" is only the text a person follows word by word: Markdown
 * message bodies, and the questions/options an agent puts to the user. Chrome
 * (timestamps, badges, buttons, tool card summary lines) and code (blocks,
 * diffs, command output — the code editor has its own font setting) keep their
 * sizes on purpose, so the level below deliberately reaches fewer places than
 * "every string in the chat".
 *
 * Both levels default to the values the chat shipped with, so an untouched
 * install renders identically to before this setting existed.
 *
 * Scaling is done by swapping size classes rather than putting CSS `zoom` on a
 * chat-wide container: the composer's menus position themselves from
 * `getBoundingClientRect()` against `window.innerWidth` (see
 * `useComposerMenuAnchor`), and a `zoom` ancestor puts those two in different
 * coordinate spaces, so the menus drift away from their trigger.
 *
 * Every class below is written out in full — Tailwind scans this file for
 * literals, so a composed string like `prose-${size}` would never be generated.
 */
export const CHAT_FONT_LEVELS = ['small', 'medium', 'large', 'xlarge'] as const;

export type ChatFontLevel = (typeof CHAT_FONT_LEVELS)[number];

export const CHAT_WIDTH_LEVELS = ['standard', 'wide', 'wider', 'full'] as const;

export type ChatWidthLevel = (typeof CHAT_WIDTH_LEVELS)[number];

export type ChatWidthClasses = {
  /** Shared by every surface spanning the content column. */
  column: string;
  /** Upper cap on the user's own message bubbles. */
  bubble: string;
};

export type ChatFontClasses = {
  /** Tailwind Typography size modifier for Markdown bodies. */
  prose: string;
  /** AskUserQuestion, inline mode — its fullscreen mode keeps its own sizes. */
  question: string;
  optionLabel: string;
  optionDescription: string;
  /** The question as echoed back once the panel has been answered. */
  answeredQuestion: string;
};

export const DEFAULT_CHAT_FONT_LEVEL: ChatFontLevel = 'small';

export const DEFAULT_CHAT_WIDTH_LEVEL: ChatWidthLevel = 'standard';

export const CHAT_FONT_STORAGE_KEY = 'chatFontLevel';

export const CHAT_WIDTH_STORAGE_KEY = 'chatWidthLevel';

/** One event for both levels — every consumer re-reads whichever it cares about. */
export const CHAT_TYPOGRAPHY_SETTINGS_CHANGED_EVENT = 'chatTypographySettingsChanged';

/**
 * AskUserQuestion grows more gently than the Markdown body: it is a compact
 * interactive panel rather than long-form prose, and every level has to stay
 * below the fullscreen sizes (19/18/15px) so inline never out-sizes fullscreen.
 */
const CHAT_FONT_CLASSES: Record<ChatFontLevel, ChatFontClasses> = {
  small: {
    prose: 'prose-sm',
    question: 'text-[14px]',
    optionLabel: 'text-[13px]',
    optionDescription: 'text-[11px]',
    answeredQuestion: 'text-[12px]',
  },
  medium: {
    prose: 'prose-base',
    question: 'text-[15px]',
    optionLabel: 'text-[14px]',
    optionDescription: 'text-[12px]',
    answeredQuestion: 'text-[13px]',
  },
  large: {
    prose: 'prose-lg',
    question: 'text-[17px]',
    optionLabel: 'text-[15px]',
    optionDescription: 'text-[13px]',
    answeredQuestion: 'text-[14px]',
  },
  xlarge: {
    prose: 'prose-xl',
    question: 'text-[18px]',
    optionLabel: 'text-[16px]',
    optionDescription: 'text-[14px]',
    answeredQuestion: 'text-[15px]',
  },
};

/**
 * `column` is read by the message list, the composer and the queued-message
 * card — they have to agree, or the composer stops lining up with the messages
 * above.
 *
 * `bubble` caps the user's own messages, which stay narrower than the column so
 * a short message doesn't stretch across it. Only the widest breakpoint follows
 * the level: below `xl` the column hasn't reached its own cap yet, so the
 * existing `sm:max-w-[85%] md:max-w-md lg:max-w-lg` ladder still describes it
 * better than a percentage would. Each value is ~66% of that level's column,
 * which is what `xl:max-w-xl` already was at the standard width.
 */
const CHAT_WIDTH_CLASSES: Record<ChatWidthLevel, ChatWidthClasses> = {
  standard: { column: 'max-w-[54.25rem]', bubble: 'xl:max-w-xl' },
  wide: { column: 'max-w-[64rem]', bubble: 'xl:max-w-[42rem]' },
  wider: { column: 'max-w-[76rem]', bubble: 'xl:max-w-[50rem]' },
  full: { column: 'max-w-none', bubble: 'xl:max-w-[66%]' },
};

export const normalizeChatFontLevel = (value: unknown): ChatFontLevel => (
  CHAT_FONT_LEVELS.includes(value as ChatFontLevel)
    ? (value as ChatFontLevel)
    : DEFAULT_CHAT_FONT_LEVEL
);

export const normalizeChatWidthLevel = (value: unknown): ChatWidthLevel => (
  CHAT_WIDTH_LEVELS.includes(value as ChatWidthLevel)
    ? (value as ChatWidthLevel)
    : DEFAULT_CHAT_WIDTH_LEVEL
);

export const getChatFontClasses = (level: ChatFontLevel): ChatFontClasses => (
  CHAT_FONT_CLASSES[level] ?? CHAT_FONT_CLASSES[DEFAULT_CHAT_FONT_LEVEL]
);

export const getChatWidthClasses = (level: ChatWidthLevel): ChatWidthClasses => (
  CHAT_WIDTH_CLASSES[level] ?? CHAT_WIDTH_CLASSES[DEFAULT_CHAT_WIDTH_LEVEL]
);

/**
 * `QuestionAnswerContent` is rendered outside the browser by its regression
 * tests, where `localStorage` doesn't exist at all — fall back to the default
 * rather than throwing on the way to a size class.
 */
const readStoredLevel = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** The single place each stored level is read from — every UI surface shares it. */
export const readChatFontLevel = (): ChatFontLevel => (
  normalizeChatFontLevel(readStoredLevel(CHAT_FONT_STORAGE_KEY))
);

export const readChatWidthLevel = (): ChatWidthLevel => (
  normalizeChatWidthLevel(readStoredLevel(CHAT_WIDTH_STORAGE_KEY))
);

/** Stores the level and notifies every mounted consumer, no reload needed. */
export const writeChatFontLevel = (level: ChatFontLevel): void => {
  localStorage.setItem(CHAT_FONT_STORAGE_KEY, level);
  window.dispatchEvent(new Event(CHAT_TYPOGRAPHY_SETTINGS_CHANGED_EVENT));
};

export const writeChatWidthLevel = (level: ChatWidthLevel): void => {
  localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, level);
  window.dispatchEvent(new Event(CHAT_TYPOGRAPHY_SETTINGS_CHANGED_EVENT));
};
