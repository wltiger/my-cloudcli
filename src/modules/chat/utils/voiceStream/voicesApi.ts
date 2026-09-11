import { voiceDirectUrl } from '@/shared/api';

function normalizeVoiceEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    if (typeof record.id === 'string') return record.id;
    if (typeof record.name === 'string') return record.name;
  }
  return '';
}

// Tolerant parser for a voice-list response: this backend's actual shape
// ({voices, uploaded_voices}), an OpenAI-style {data:[...]} list, or a plain
// array. Never throws — malformed/missing fields just yield fewer voices.
export function parseVoiceList(payload: unknown): string[] {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const primary = Array.isArray(record.voices)
    ? record.voices
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(payload)
        ? payload
        : [];
  const extra = Array.isArray(record.uploaded_voices) ? record.uploaded_voices : [];

  const names = [...primary, ...extra].map(normalizeVoiceEntry).filter((name) => name.length > 0);
  return Array.from(new Set(names));
}

// Fetches and parses the backend's voice-list endpoint. Throws on a network
// error or non-2xx response; the caller decides how to surface that (the
// voice field itself must keep working as free text regardless).
export async function fetchVoiceList(baseUrl: string, apiKey: string): Promise<string[]> {
  const response = await fetch(voiceDirectUrl(baseUrl.replace(/\/$/, ''), '/audio/voices'), {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Voice list request failed (${response.status})`);
  }
  const payload = await response.json();
  return parseVoiceList(payload);
}
