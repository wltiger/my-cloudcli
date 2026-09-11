import assert from 'node:assert/strict';

import { test, vi } from 'vitest';

import { streamingVoicePlayer } from '@/modules/chat/utils/voiceStream/streamingPlayer';

// A single-byte chunk never decodes to a full sample (see pcmAlign.ts), so
// PcmStreamPlayer.push() returns before touching AudioContext — letting
// these tests exercise the real fetch/state-machine logic under Node
// without needing a browser's Web Audio API.
const UNDECODABLE_CHUNK = new Uint8Array([0x42]);

function fakeStorage(initial: Record<string, string> = {}): { restore: () => void } {
  localStorage.clear();
  for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, value);
  return {
    restore: () => {
      localStorage.clear();
    },
  };
}

function fakeStreamingFetch(chunks: Uint8Array[]): {
  calls: Array<{ url: string; init: RequestInit }>;
  restore: () => void;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    let index = 0;
    const reader = {
      read: async () => {
        if (index < chunks.length) {
          const value = chunks[index++];
          return { done: false, value };
        }
        return { done: true, value: undefined };
      },
    };
    return { ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response;
  }) as typeof fetch);
  return {
    calls,
    restore: () => {
      vi.unstubAllGlobals();
    },
  };
}

const BASE_VOICE_CONFIG = {
  baseUrl: 'http://example.test/v1',
  apiKey: '',
  sttModel: '',
  ttsModel: '',
  ttsVoice: 'serena',
  ttsFormat: '',
};

async function flush(): Promise<void> {
  // Enough macrotask ticks for play()'s several `await` points (fetch, two
  // reader.read() calls, waitForDrain()) to each drain their microtasks.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('streaming play() requests stream/pcm fields and includes instructions when set', async () => {
  const storage = fakeStorage({
    voiceConfig: JSON.stringify(BASE_VOICE_CONFIG),
    voiceStreamConfig: JSON.stringify({ instructions: 'speak warmly', streamEnabled: true }),
  });
  const fetchSpy = fakeStreamingFetch([UNDECODABLE_CHUNK]);
  try {
    streamingVoicePlayer.toggle('hello', 'test-id-1');
    await flush();

    assert.equal(fetchSpy.calls.length, 1);
    const body = JSON.parse(fetchSpy.calls[0].init.body as string);
    assert.equal(body.stream, true);
    assert.equal(body.stream_format, 'audio');
    assert.equal(body.response_format, 'pcm');
    assert.equal(body.instructions, 'speak warmly');
    assert.equal(streamingVoicePlayer.getSnapshot('test-id-1').state, 'idle');
  } finally {
    streamingVoicePlayer.stop();
    storage.restore();
    fetchSpy.restore();
  }
});

test('streaming play() omits instructions from the request body when empty', async () => {
  const storage = fakeStorage({
    voiceConfig: JSON.stringify(BASE_VOICE_CONFIG),
  });
  const fetchSpy = fakeStreamingFetch([UNDECODABLE_CHUNK]);
  try {
    streamingVoicePlayer.toggle('hello again', 'test-id-2');
    await flush();

    const body = JSON.parse(fetchSpy.calls[0].init.body as string);
    assert.equal('instructions' in body, false);
  } finally {
    streamingVoicePlayer.stop();
    storage.restore();
    fetchSpy.restore();
  }
});

test('a response that completes with zero bytes is surfaced as an error', async () => {
  const storage = fakeStorage({
    voiceConfig: JSON.stringify(BASE_VOICE_CONFIG),
  });
  const fetchSpy = fakeStreamingFetch([]); // reader.read() immediately reports done, no chunks
  try {
    streamingVoicePlayer.toggle('empty', 'test-id-3');
    await flush();

    const snapshot = streamingVoicePlayer.getSnapshot('test-id-3');
    assert.equal(snapshot.state, 'idle');
    assert.ok(snapshot.error, 'expected an error for a zero-byte stream');
  } finally {
    streamingVoicePlayer.stop();
    storage.restore();
    fetchSpy.restore();
  }
});
