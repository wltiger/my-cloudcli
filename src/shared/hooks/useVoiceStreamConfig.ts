import { useEffect, useState } from 'react';

import type { VoiceStreamConfig } from '@/shared/voiceStreamConfig';
import {
  readVoiceStreamConfig,
  VOICE_STREAM_CONFIG_DEFAULTS,
  VOICE_STREAM_CONFIG_SYNC_EVENT,
  writeVoiceStreamConfig,
} from '@/shared/voiceStreamConfig';

// React layer over the fork-owned voiceStreamConfig storage. Split out of that module
// for the same reason upstream split useVoiceConfig out of shared/voiceConfig.ts: the
// storage readers are imported by shared/api.ts, which must stay free of React. Used by
// the settings module (VoiceStreamingSection, VoiceTestReadControl) and the chat module
// (MessageSpeakControl).

export function useVoiceStreamConfig() {
  const [config, setConfig] = useState<VoiceStreamConfig>(() =>
    typeof window === 'undefined' ? { ...VOICE_STREAM_CONFIG_DEFAULTS } : readVoiceStreamConfig(),
  );

  // Re-sync when another mounted instance of this hook writes a change —
  // e.g. VoiceStreamingSection (owns the form) and VoiceTestReadControl
  // (reads config.streamEnabled) both call this hook independently.
  useEffect(() => {
    const sync = () => setConfig(readVoiceStreamConfig());
    window.addEventListener(VOICE_STREAM_CONFIG_SYNC_EVENT, sync);
    return () => window.removeEventListener(VOICE_STREAM_CONFIG_SYNC_EVENT, sync);
  }, []);

  const update = (patch: Partial<VoiceStreamConfig>) => {
    setConfig(writeVoiceStreamConfig(patch));
  };

  return { config, update };
}

// Lightweight, live-reactive read for consumers that stay mounted across a
// Settings change (e.g. a per-message speak control) rather than owning the
// form — mirrors useVoiceAvailable's pattern of listening for the sync event
// instead of only reading once at mount.
export function useStreamingEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window === 'undefined' ? VOICE_STREAM_CONFIG_DEFAULTS.streamEnabled : readVoiceStreamConfig().streamEnabled,
  );

  useEffect(() => {
    const update = () => setEnabled(readVoiceStreamConfig().streamEnabled);
    update();
    window.addEventListener(VOICE_STREAM_CONFIG_SYNC_EVENT, update);
    return () => window.removeEventListener(VOICE_STREAM_CONFIG_SYNC_EVENT, update);
  }, []);

  return enabled;
}
