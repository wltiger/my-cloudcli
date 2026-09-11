import assert from 'node:assert/strict';

import { test, vi } from 'vitest';

import { synthesizeVoice } from '@/shared/api';

function fakeStorage(initial: Record<string, string> = {}): { restore: () => void } {
  localStorage.clear();
  for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, value);
  return {
    restore: () => {
      localStorage.clear();
    },
  };
}

function fakeFetch(): { calls: Array<{ url: string; init: RequestInit }>; restore: () => void } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob() } as unknown as Response;
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

test('synthesizeVoice includes instructions in the direct-backend request body when set', async () => {
  const storage = fakeStorage({
    voiceConfig: JSON.stringify(BASE_VOICE_CONFIG),
    voiceStreamConfig: JSON.stringify({ instructions: 'speak gently and slowly' }),
  });
  const fetchSpy = fakeFetch();
  try {
    await synthesizeVoice('hello', new AbortController().signal);
    assert.equal(fetchSpy.calls.length, 1);
    const body = JSON.parse(fetchSpy.calls[0].init.body as string);
    assert.equal(body.instructions, 'speak gently and slowly');
  } finally {
    storage.restore();
    fetchSpy.restore();
  }
});

test('synthesizeVoice omits instructions from the request body when empty', async () => {
  const storage = fakeStorage({
    voiceConfig: JSON.stringify(BASE_VOICE_CONFIG),
  });
  const fetchSpy = fakeFetch();
  try {
    await synthesizeVoice('hello', new AbortController().signal);
    const body = JSON.parse(fetchSpy.calls[0].init.body as string);
    assert.equal('instructions' in body, false);
  } finally {
    storage.restore();
    fetchSpy.restore();
  }
});
