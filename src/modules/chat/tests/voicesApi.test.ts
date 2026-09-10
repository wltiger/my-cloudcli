import assert from 'node:assert/strict';

import { test } from 'vitest';

import { parseVoiceList } from '@/modules/chat/utils/voiceStream/voicesApi';

test('parseVoiceList handles the backend real shape (voices + uploaded_voices)', () => {
  const result = parseVoiceList({ voices: ['aiden', 'serena'], uploaded_voices: ['my-clone'] });
  assert.deepEqual(result, ['aiden', 'serena', 'my-clone']);
});

test('parseVoiceList handles an OpenAI-style {data:[...]} shape', () => {
  const result = parseVoiceList({ data: [{ id: 'alloy' }, { name: 'echo' }] });
  assert.deepEqual(result, ['alloy', 'echo']);
});

test('parseVoiceList handles a plain array', () => {
  const result = parseVoiceList(['aiden', 'serena']);
  assert.deepEqual(result, ['aiden', 'serena']);
});

test('parseVoiceList dedupes repeated names across voices and uploaded_voices', () => {
  const result = parseVoiceList({ voices: ['aiden', 'aiden'], uploaded_voices: ['aiden'] });
  assert.deepEqual(result, ['aiden']);
});

test('parseVoiceList tolerates malformed/empty input without throwing', () => {
  assert.deepEqual(parseVoiceList(null), []);
  assert.deepEqual(parseVoiceList(undefined), []);
  assert.deepEqual(parseVoiceList({}), []);
  assert.deepEqual(parseVoiceList({ voices: null }), []);
  assert.deepEqual(parseVoiceList('not an object'), []);
});

test('parseVoiceList drops non-string, non-named entries and empty strings', () => {
  const result = parseVoiceList({ voices: [null, 123, {}, '', 'ok'] });
  assert.deepEqual(result, ['ok']);
});
