import { useCallback, useEffect, useState } from 'react';

import { voiceId } from '@/modules/chat/utils/voicePlayer';
import { streamingVoicePlayer } from '@/modules/chat/utils/voiceStream/streamingPlayer';
import type { StreamingVoiceSnapshot } from '@/modules/chat/utils/voiceStream/streamingPlayer';
import { voiceCacheSignature } from '@/shared/voiceStreamConfig';

export type StreamingTtsState = StreamingVoiceSnapshot['state'];

// Streaming counterpart to useTts: same thin-adapter shape, but reflects
// streamingVoicePlayer instead of the upstream blob-based voicePlayer.
export function useStreamingTts(getText: () => string) {
  const content = getText();
  const id = voiceId(content, voiceCacheSignature());

  const [snap, setSnap] = useState<StreamingVoiceSnapshot>(() => streamingVoicePlayer.getSnapshot(id));

  useEffect(() => {
    const update = () =>
      setSnap((prev) => {
        const next = streamingVoicePlayer.getSnapshot(id);
        return prev.state === next.state && prev.error === next.error ? prev : next;
      });
    update();
    return streamingVoicePlayer.subscribe(update);
  }, [id]);

  const toggle = useCallback(() => {
    streamingVoicePlayer.unlock(); // synchronous, within the click gesture (iOS)
    streamingVoicePlayer.toggle(content, id);
  }, [content, id]);

  return { state: snap.state, toggle, error: snap.error };
}
