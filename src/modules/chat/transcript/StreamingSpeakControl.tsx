import { Volume2, Loader2, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useStreamingTts } from '@/modules/chat/hooks/useStreamingTts';

// Streaming counterpart to MessageSpeakControl: identical markup and the
// same chat.voice.* labels/idle-loading-playing states, backed by
// streamingVoicePlayer instead of the upstream voicePlayer. Rendered by
// MessageSpeakControl in place of its own body when streaming is enabled —
// kept as a separate component rather than branching inside
// MessageSpeakControl's body, see docs/fork-customizations.md.
const StreamingSpeakControl = ({ content }: { content: string }) => {
  const { t } = useTranslation('chat');
  const { state, toggle, error } = useStreamingTts(() => content);

  const title =
    state === 'playing' ? t('voice.stopSpeaking') : state === 'loading' ? t('voice.loading') : t('voice.speak');

  return (
    <span className="relative inline-flex">
      {error && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 max-w-[240px] -translate-x-1/2 whitespace-normal rounded bg-red-600 px-2 py-1 text-center text-xs text-white shadow-lg">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={toggle}
        title={title}
        aria-label={title}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      >
        {state === 'playing' ? (
          <Square className="h-3.5 w-3.5" />
        ) : state === 'loading' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Volume2 className="h-3.5 w-3.5" />
        )}
      </button>
    </span>
  );
};

export default StreamingSpeakControl;
