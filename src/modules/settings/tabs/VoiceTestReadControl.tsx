import { useState } from 'react';
import { Volume2, Loader2, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useStreamingTts, useTts } from '@/modules/chat';
import { useVoiceStreamConfig } from '@/shared/hooks/useVoiceStreamConfig';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

// Exercises the exact same synthesis path (streaming or non-streaming) a
// real chat message's speak button would take against the current config,
// so the user can validate their whole setup from Settings.
export default function VoiceTestReadControl() {
  const { t } = useTranslation('settings');
  const { t: tChat } = useTranslation('chat');
  const { config } = useVoiceStreamConfig();
  const [text, setText] = useState(() => t('voiceStreaming.testDefaultText'));

  const nonStreaming = useTts(() => text);
  const streaming = useStreamingTts(() => text);
  const { state, toggle, error } = config.streamEnabled ? streaming : nonStreaming;

  const buttonLabel =
    state === 'playing' ? tChat('voice.stopSpeaking') : state === 'loading' ? tChat('voice.loading') : t('voiceStreaming.testButton');

  return (
    <div className="space-y-1">
      <span className="text-sm font-medium text-foreground">{t('voiceStreaming.testLabel')}</span>
      <div className="flex items-center gap-2">
        <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} />
        <button
          type="button"
          onClick={toggle}
          disabled={state === 'loading'}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === 'playing' ? (
            <Square className="h-3.5 w-3.5" />
          ) : state === 'loading' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
          {buttonLabel}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
