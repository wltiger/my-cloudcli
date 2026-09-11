import { readVoiceConfig } from '@/shared/voiceConfig';

// Fork-owned config layer for the streaming-TTS extensions (instructions
// text, the streaming toggle, and — added by a later ticket — the test-read
// text). Kept separate from the upstream `voiceConfig` storage/hook so this
// feature's logic never has to edit that upstream-owned module. Lives beside
// that module in src/shared, and is React-free for the same reason it is:
// shared/api.ts sits below every module in the dependency graph and needs
// readVoiceStreamConfig() to attach the instructions field. The hooks over
// this storage live in shared/hooks/useVoiceStreamConfig.ts.

export type VoiceStreamConfig = {
  instructions: string;
  streamEnabled: boolean;
};

const STORAGE_KEY = 'voiceStreamConfig';
export const VOICE_STREAM_CONFIG_SYNC_EVENT = 'voice-stream-config:sync';
export const VOICE_STREAM_CONFIG_DEFAULTS: VoiceStreamConfig = { instructions: '', streamEnabled: false };

export function readVoiceStreamConfig(): VoiceStreamConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...VOICE_STREAM_CONFIG_DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...VOICE_STREAM_CONFIG_DEFAULTS };
    }
    const config = { ...VOICE_STREAM_CONFIG_DEFAULTS };
    if (typeof parsed.instructions === 'string') config.instructions = parsed.instructions;
    if (typeof parsed.streamEnabled === 'boolean') config.streamEnabled = parsed.streamEnabled;
    return config;
  } catch {
    return { ...VOICE_STREAM_CONFIG_DEFAULTS };
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
