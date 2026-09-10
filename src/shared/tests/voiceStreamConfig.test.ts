import assert from 'node:assert/strict';

import { test } from 'vitest';

import { readVoiceStreamConfig, voiceCacheSignature, writeVoiceStreamConfig } from '@/shared/voiceStreamConfig';

function fakeStorage(initial: Record<string, string> = {}): { restore: () => void } {
  localStorage.clear();
  for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, value);
  return {
    restore: () => {
      localStorage.clear();
    },
  };
}

test('readVoiceStreamConfig defaults to empty instructions and streaming off when nothing is stored', () => {
  const { restore } = fakeStorage();
  try {
    assert.deepEqual(readVoiceStreamConfig(), { instructions: '', streamEnabled: false });
  } finally {
    restore();
  }
});

test('writeVoiceStreamConfig persists and round-trips through readVoiceStreamConfig', () => {
  const { restore } = fakeStorage();
  try {
    writeVoiceStreamConfig({ instructions: 'speak gently and slowly' });
    assert.deepEqual(readVoiceStreamConfig(), { instructions: 'speak gently and slowly', streamEnabled: false });
  } finally {
    restore();
  }
});

test('writeVoiceStreamConfig persists the streaming toggle independently of instructions', () => {
  const { restore } = fakeStorage();
  try {
    writeVoiceStreamConfig({ instructions: 'speak gently' });
    writeVoiceStreamConfig({ streamEnabled: true });
    assert.deepEqual(readVoiceStreamConfig(), { instructions: 'speak gently', streamEnabled: true });
  } finally {
    restore();
  }
});

test('readVoiceStreamConfig falls back to defaults on malformed stored JSON', () => {
  const { restore } = fakeStorage({ voiceStreamConfig: 'not json' });
  try {
    assert.deepEqual(readVoiceStreamConfig(), { instructions: '', streamEnabled: false });
  } finally {
    restore();
  }
});

test('readVoiceStreamConfig falls back to defaults when stored value is not an object', () => {
  const { restore } = fakeStorage({ voiceStreamConfig: JSON.stringify(['not', 'an', 'object']) });
  try {
    assert.deepEqual(readVoiceStreamConfig(), { instructions: '', streamEnabled: false });
  } finally {
    restore();
  }
});

test('readVoiceStreamConfig ignores a wrong-typed streamEnabled value and keeps the default', () => {
  const { restore } = fakeStorage({ voiceStreamConfig: JSON.stringify({ instructions: 'x', streamEnabled: 'yes' }) });
  try {
    assert.deepEqual(readVoiceStreamConfig(), { instructions: 'x', streamEnabled: false });
  } finally {
    restore();
  }
});

test('voiceCacheSignature changes when instructions changes', () => {
  const { restore } = fakeStorage();
  try {
    const before = voiceCacheSignature();
    writeVoiceStreamConfig({ instructions: 'speak angrily' });
    const after = voiceCacheSignature();
    assert.notEqual(before, after);
  } finally {
    restore();
  }
});

test('voiceCacheSignature changes when the base voice config changes', () => {
  const { restore } = fakeStorage();
  try {
    const before = voiceCacheSignature();
    localStorage.setItem(
      'voiceConfig',
      JSON.stringify({ baseUrl: 'http://example.test', apiKey: '', sttModel: '', ttsModel: '', ttsVoice: 'serena', ttsFormat: '' }),
    );
    const after = voiceCacheSignature();
    assert.notEqual(before, after);
  } finally {
    restore();
  }
});
