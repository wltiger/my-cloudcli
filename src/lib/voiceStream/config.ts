import { useEffect, useState } from 'react';

import { readVoiceConfig } from '../../hooks/useVoiceConfig';

// Fork-owned config layer for the streaming-TTS extensions (instructions
// text, the streaming toggle, and — added by a later ticket — the test-read
// text). Kept separate from the upstream `voiceConfig` storage/hook so this
// feature's logic never has to edit that upstream-owned module.

export type VoiceStreamConfig = {
  instructions: string;
  streamEnabled: boolean;
};

const STORAGE_KEY = 'voiceStreamConfig';
export const VOICE_STREAM_CONFIG_SYNC_EVENT = 'voice-stream-config:sync';
const DEFAULTS: VoiceStreamConfig = { instructions: '', streamEnabled: false };

export function readVoiceStreamConfig(): VoiceStreamConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULTS };
    const config = { ...DEFAULTS };
    if (typeof parsed.instructions === 'string') config.instructions = parsed.instructions;
    if (typeof parsed.streamEnabled === 'boolean') config.streamEnabled = parsed.streamEnabled;
    return config;
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeVoiceStreamConfig(patch: Partial<VoiceStreamConfig>): VoiceStreamConfig {
  const next = { ...readVoiceStreamConfig(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(VOICE_STREAM_CONFIG_SYNC_EVENT));
  } catch {
    /* ignore persistence errors */
  }
  return next;
}

// Cache-key input for voicePlayer.voiceId(): combines the upstream voice
// config with this module's own config, so changing instructions (or any
// future field here) invalidates the per-message audio cache instead of
// silently replaying stale audio.
export function voiceCacheSignature(): string {
  return JSON.stringify([readVoiceConfig(), readVoiceStreamConfig()]);
}

export function useVoiceStreamConfig() {
  const [config, setConfig] = useState<VoiceStreamConfig>(() =>
    typeof window === 'undefined' ? { ...DEFAULTS } : readVoiceStreamConfig(),
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
    typeof window === 'undefined' ? DEFAULTS.streamEnabled : readVoiceStreamConfig().streamEnabled,
  );

  useEffect(() => {
    const update = () => setEnabled(readVoiceStreamConfig().streamEnabled);
    update();
    window.addEventListener(VOICE_STREAM_CONFIG_SYNC_EVENT, update);
    return () => window.removeEventListener(VOICE_STREAM_CONFIG_SYNC_EVENT, update);
  }, []);

  return enabled;
}
