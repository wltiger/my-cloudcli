import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';
import { useVoiceStreamConfig } from '../../../../lib/voiceStream/config';
import { fetchVoiceList } from '../../../../lib/voiceStream/voicesApi';

import VoiceTestReadControl from './VoiceTestReadControl';

type VoiceStreamingSectionProps = {
  baseUrl: string;
  apiKey: string;
};

// Fork-owned extensions for a directly-called custom voice backend that
// supports more than the plain OpenAI-compatible /audio/speech contract
// (e.g. Qwen3-TTS): style instructions and voice-list fetch here, streaming
// playback added by a later ticket. Mounted into VoiceSettingsTab. The
// fetched voices render as a <datalist> whose id the upstream Voice field
// wires up via a plain `list=` attribute, not a new duplicate input here.
export default function VoiceStreamingSection({ baseUrl, apiKey }: VoiceStreamingSectionProps) {
  const { t } = useTranslation('settings');
  const { config, update } = useVoiceStreamConfig();
  const [voices, setVoices] = useState<string[]>([]);
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'error'>('idle');

  const handleFetchVoices = async () => {
    if (!baseUrl.trim()) return;
    setFetchState('loading');
    try {
      const result = await fetchVoiceList(baseUrl.trim(), apiKey);
      setVoices(result);
      setFetchState('idle');
    } catch {
      setFetchState('error');
    }
  };

  return (
    <SettingsSection title={t('voiceStreaming.title')} description={t('voiceStreaming.description')}>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="pr-3">
            <div className="text-sm font-medium text-foreground">{t('voiceStreaming.streamEnabled')}</div>
            <div className="text-xs text-muted-foreground">{t('voiceStreaming.streamEnabledDescription')}</div>
          </div>
          <SettingsToggle
            checked={config.streamEnabled}
            onChange={(v) => update({ streamEnabled: v })}
            ariaLabel={t('voiceStreaming.streamEnabled')}
          />
        </div>

        <div>
          <button
            type="button"
            onClick={() => void handleFetchVoices()}
            disabled={!baseUrl.trim() || fetchState === 'loading'}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {fetchState === 'loading' ? t('voiceStreaming.fetchingVoices') : t('voiceStreaming.fetchVoices')}
          </button>
          {fetchState === 'error' && (
            <p className="mt-1 text-xs text-red-500">{t('voiceStreaming.fetchVoicesError')}</p>
          )}
          {fetchState === 'idle' && voices.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('voiceStreaming.fetchVoicesSuccess', { count: voices.length })}
            </p>
          )}
          <datalist id="voiceStreamVoiceSuggestions">
            {voices.map((voice) => (
              <option key={voice} value={voice} />
            ))}
          </datalist>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">{t('voiceStreaming.instructions')}</span>
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            rows={2}
            placeholder={t('voiceStreaming.instructionsPlaceholder')}
            value={config.instructions}
            onChange={(e) => update({ instructions: e.target.value })}
          />
        </label>

        <VoiceTestReadControl />
      </div>
    </SettingsSection>
  );
}
