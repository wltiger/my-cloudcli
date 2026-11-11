import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Rendered by chat's QuestionAnswerContent (the answered-question card) under
 * a question's answer: the notes the user added to it, on one line.
 */
export const AskQuestionNotesLine: React.FC<{ notes: string; className?: string }> = ({ notes, className = '' }) => {
  const { t } = useTranslation();
  return (
    <div className={`mt-1 whitespace-pre-wrap break-words leading-snug text-gray-600 dark:text-gray-400 ${className}`}>
      {/* The label carries its own colon, so each language picks its form. */}
      <span className="mr-1 font-medium text-gray-500 dark:text-gray-400">
        {t('chat:misc.notesLabel', { defaultValue: 'Notes:' })}
      </span>
      {notes}
    </div>
  );
};
