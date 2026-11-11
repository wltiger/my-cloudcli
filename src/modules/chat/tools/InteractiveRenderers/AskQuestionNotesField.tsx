import React, { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** Same cap as the "Other" field: about five lines, then it scrolls. */
const NOTES_FIELD_MAX_HEIGHT_PX = 120;

const fitField = (field: HTMLTextAreaElement) => {
  field.style.height = 'auto';
  field.style.height = `${Math.min(field.scrollHeight, NOTES_FIELD_MAX_HEIGHT_PX)}px`;
};

type AskQuestionNotesFieldProps = {
  open: boolean;
  value: string;
  isFullscreen: boolean;
  fieldClassName: string;
  fieldRef: React.RefObject<HTMLTextAreaElement>;
  onOpen: () => void;
  onChange: (text: string) => void;
  /** Ctrl/Cmd+Enter: go to the next question, or submit on the last one. */
  onAdvance: () => void;
};

/**
 * Rendered by chat's AskUserQuestionPanel under each question's options: the
 * "+ Add notes" entry, so the user can add context to a picked option.
 * Closed it is one row (also opened with the `n` key, handled by the panel);
 * open it is a multi-line field. It mirrors the panel's "Other" field on
 * purpose — height cap, auto-grow, keys (Enter is a line break, Ctrl/Cmd+Enter
 * advances, nothing typed reaches the panel's shortcuts) and styling — kept as
 * a copy so the upstream panel is not refactored; recheck it when upstream
 * changes that field.
 */
export const AskQuestionNotesField: React.FC<AskQuestionNotesFieldProps> = ({
  open,
  value,
  isFullscreen,
  fieldClassName,
  fieldRef,
  onOpen,
  onChange,
  onAdvance,
}) => {
  const { t } = useTranslation();

  // Re-fit whenever the text changes from outside: a step whose notes span
  // more or fewer lines comes into view, or fullscreen re-mounts the field.
  useLayoutEffect(() => {
    if (open && fieldRef.current) fitField(fieldRef.current);
  }, [open, value, isFullscreen, fieldRef]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-1 text-left transition-colors hover:bg-gray-50/60 dark:hover:bg-gray-700/40"
      >
        <kbd className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-100 font-mono text-[10px] text-gray-400 group-hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500 dark:group-hover:border-gray-600">
          n
        </kbd>
        <span className={`leading-tight text-gray-500 dark:text-gray-400 ${isFullscreen ? 'text-[16px]' : 'text-[12px]'}`}>
          + {t('chat:misc.addNotes', { defaultValue: 'Add notes' })}
        </span>
      </button>
    );
  }

  const placeholder = t('chat:misc.notesPlaceholder', { defaultValue: 'Add notes to your answer (optional)…' });
  return (
    <div className="pl-[30px] pr-0.5">
      <textarea
        ref={fieldRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onAdvance();
          }
          e.stopPropagation();
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`block w-full resize-none overflow-y-auto rounded-lg border-0 bg-gray-50 px-3 py-1.5 ${fieldClassName} text-gray-900 outline-none ring-1 ring-gray-200 transition-shadow duration-200 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-400 dark:bg-gray-900/60 dark:text-gray-100 dark:ring-gray-700 dark:placeholder:text-gray-600 dark:focus:ring-blue-500`}
      />
    </div>
  );
};
