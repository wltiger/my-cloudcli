import assert from 'node:assert/strict';
import test from 'node:test';

import { prettifyModelLabel } from './modelLabel';

test('prettifies a bare family id', () => {
  assert.equal(prettifyModelLabel('claude-sonnet'), 'Sonnet');
  assert.equal(prettifyModelLabel('claude-opus'), 'Opus');
  assert.equal(prettifyModelLabel('claude-haiku'), 'Haiku');
  assert.equal(prettifyModelLabel('claude-fable'), 'Fable');
});

test('prettifies a family with a version', () => {
  assert.equal(prettifyModelLabel('claude-opus-5'), 'Opus 5');
  assert.equal(prettifyModelLabel('claude-sonnet-4-5'), 'Sonnet 4.5');
});

test('drops the trailing build date from the label', () => {
  assert.equal(prettifyModelLabel('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(prettifyModelLabel('claude-opus-4-1-20250805'), 'Opus 4.1');
  assert.equal(prettifyModelLabel('claude-haiku-20251001'), 'Haiku');
});

test('preserves a long-context marker', () => {
  assert.equal(prettifyModelLabel('claude-sonnet[1m]'), 'Sonnet [1M]');
  assert.equal(prettifyModelLabel('claude-sonnet-4-5[1m]'), 'Sonnet 4.5 [1M]');
  assert.equal(prettifyModelLabel('claude-opus-4-1-20250805[1m]'), 'Opus 4.1 [1M]');
});

test('tolerates surrounding whitespace and id casing', () => {
  assert.equal(prettifyModelLabel('  claude-sonnet-4-5  '), 'Sonnet 4.5');
  assert.equal(prettifyModelLabel('CLAUDE-OPUS-5'), 'Opus 5');
});

test('gives up on ids that are not shaped like a Claude model id', () => {
  // The single most important behaviour: never guess. The caller shows the raw
  // id whenever this returns null.
  assert.equal(prettifyModelLabel(''), null);
  assert.equal(prettifyModelLabel('   '), null);
  assert.equal(prettifyModelLabel('default'), null);
  assert.equal(prettifyModelLabel('sonnet'), null);
  assert.equal(prettifyModelLabel('sonnet[1m]'), null);
  assert.equal(prettifyModelLabel('gpt-5-codex'), null);
  assert.equal(prettifyModelLabel('gemini-3-pro'), null);
  assert.equal(prettifyModelLabel('anthropic.claude-opus-5'), null);
  assert.equal(prettifyModelLabel('some totally unrelated string'), null);
});

test('gives up on a claude- id whose family it does not recognise', () => {
  assert.equal(prettifyModelLabel('claude-'), null);
  assert.equal(prettifyModelLabel('claude-turbo-5'), null);
  assert.equal(prettifyModelLabel('claude-2.1'), null);
});

test('gives up on trailing segments it cannot read as a version or a date', () => {
  assert.equal(prettifyModelLabel('claude-sonnet-next'), null);
  assert.equal(prettifyModelLabel('claude-sonnet-4-5-2025'), null);
  assert.equal(prettifyModelLabel('claude-sonnet-20250929-preview'), null);
  assert.equal(prettifyModelLabel('claude-opus-4-1-20250805-20250806'), null);
});

test('gives up on a marker it does not recognise', () => {
  assert.equal(prettifyModelLabel('claude-sonnet-4-5[2m]'), null);
  assert.equal(prettifyModelLabel('claude-sonnet-4-5[]'), null);
  assert.equal(prettifyModelLabel('claude-sonnet-4-5[1m'), null);
});

test('gives up on values that are not strings', () => {
  assert.equal(prettifyModelLabel(null), null);
  assert.equal(prettifyModelLabel(undefined), null);
  assert.equal(prettifyModelLabel(42), null);
  assert.equal(prettifyModelLabel({ model: 'claude-opus-5' }), null);
});
