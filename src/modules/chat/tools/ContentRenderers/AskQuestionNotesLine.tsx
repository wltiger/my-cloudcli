import React from 'react';
import { useTranslation } from 'react-i18next';

/** The notes the user added to one answered question, as one line on the card. */
export const AskQuestionNotesLine: React.FC<{ notes: string; className?: string }> = ({ notes, className = '' }) => {
  const { t } = useTranslation();
  return (
    <div className={`mt-1 whitespace-pre-wrap break-words leading-snug text-gray-600 dark:text-gray-400 ${className}`}>
      <span className="mr-1 font-medium text-gray-500 dark:text-gray-400">
        {t('chat:misc.notesLabel', { defaultValue: 'Notes' })}:
      </span>
      {notes}
    </div>
  );
};
