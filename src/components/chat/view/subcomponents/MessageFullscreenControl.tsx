import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FullscreenSurface, FullscreenToggleButton } from '../../../../shared/view/ui';

import { Markdown } from './Markdown';

/** Opens a long assistant message in a full-viewport reading surface. */
const MessageFullscreenControl = ({ content }: { content: string }) => {
  const { t } = useTranslation('chat');
  const [isFullscreen, setIsFullscreen] = useState(false);

  if (!content.trim()) return null;

  return (
    <>
      <FullscreenToggleButton
        label={t('fullscreen.expand', { defaultValue: 'Fullscreen' })}
        onClick={() => setIsFullscreen(true)}
        className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      />
      <FullscreenSurface
        open={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        title={t('fullscreen.messageTitle', { defaultValue: 'Message' })}
        closeLabel={t('fullscreen.exit', { defaultValue: 'Exit fullscreen' })}
      >
        <Markdown className="prose prose-gray max-w-none font-serif dark:prose-invert">
          {content}
        </Markdown>
      </FullscreenSurface>
    </>
  );
};

export default MessageFullscreenControl;
