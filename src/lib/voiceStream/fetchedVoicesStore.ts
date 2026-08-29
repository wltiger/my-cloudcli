import { useEffect, useState } from 'react';

// Shared, event-synced store for the last successfully fetched voice list.
// VoiceStreamingSection (owns the "fetch voices" action) writes it;
// VoiceComboBoxField (lives in the separate, upstream-owned
// VoiceSettingsTab) reads it. Same subscribe pattern as
// config.ts's useStreamingEnabled() — used here because the two consumers
// are sibling components with no natural prop path between them, and
// threading the list through VoiceSettingsTab as a prop would mean editing
// that upstream file's render tree instead of swapping one field component
// for another. Purely in-memory, matching the list's existing behavior of
// resetting on reload (it was never persisted before this store existed).

let fetchedVoices: string[] = [];
const FETCHED_VOICES_SYNC_EVENT = 'voice-stream-fetched-voices:sync';

export function setFetchedVoices(voices: string[]): void {
  fetchedVoices = voices;
  window.dispatchEvent(new Event(FETCHED_VOICES_SYNC_EVENT));
}

export function useFetchedVoices(): string[] {
  const [voices, setVoices] = useState<string[]>(() => (typeof window === 'undefined' ? [] : fetchedVoices));

  useEffect(() => {
    const sync = () => setVoices(fetchedVoices);
    window.addEventListener(FETCHED_VOICES_SYNC_EVENT, sync);
    return () => window.removeEventListener(FETCHED_VOICES_SYNC_EVENT, sync);
  }, []);

  return voices;
}
