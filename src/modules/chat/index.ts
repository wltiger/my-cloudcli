export { default as ChatInterface } from '@/modules/chat/ChatInterface';
export { getClaudeSettings } from '@/modules/chat/utils/chatStorage';

// Read-aloud internals the settings module reuses: its Voice tab drives the exact same
// synthesis paths a chat message's speak button takes (VoiceTestReadControl), and owns
// the "fetch voices" action whose result the voice combobox reads (VoiceComboBoxField).
export { useTts } from '@/modules/chat/hooks/useTts';
export { useStreamingTts } from '@/modules/chat/hooks/useStreamingTts';
export { setFetchedVoices, useFetchedVoices } from '@/modules/chat/utils/voiceStream/fetchedVoicesStore';
export { fetchVoiceList } from '@/modules/chat/utils/voiceStream/voicesApi';
