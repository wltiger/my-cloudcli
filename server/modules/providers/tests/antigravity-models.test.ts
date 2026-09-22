/**
 * Antigravity model catalog — the pure merge layer.
 *
 * `agy models` is the only enumeration the CLI offers and it is auth-gated, so
 * what the picker shows is the static catalog with whatever the live list adds
 * merged in. These tests are text in / data out: nothing here spawns `agy`, and
 * the live list is always a synthetic one.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANTIGRAVITY_PREDEFINED_MODELS,
  mergeLiveModelIds,
  parseAgyModelsOutput,
} from '@/modules/providers/list/antigravity/antigravity-models.provider.js';

const modelIds = (models: { OPTIONS: Array<{ value: string }> }): string[] =>
  models.OPTIONS.map((option) => option.value);

test('the shipped catalog offers its own default and never invents a context window', () => {
  assert.ok(
    modelIds(ANTIGRAVITY_PREDEFINED_MODELS).includes(ANTIGRAVITY_PREDEFINED_MODELS.DEFAULT),
    'the default model must be selectable in the picker',
  );
  // No context-window figure is published anywhere for these models, so the
  // usage readout has to stay on the server default rather than a made-up one.
  assert.equal(
    ANTIGRAVITY_PREDEFINED_MODELS.OPTIONS.some((option) => option.contextWindow !== undefined),
    false,
  );
});

test('reasoning effort is a model choice, not a separate control', () => {
  // Effort is baked into the id (`-high`/`-medium`/`-low`), which is why the
  // picker offers three Gemini 3.8 Flash entries instead of one plus a dial.
  const ids = modelIds(ANTIGRAVITY_PREDEFINED_MODELS);
  for (const suffix of ['-high', '-medium', '-low']) {
    assert.ok(ids.includes(`gemini-3.8-flash${suffix}`), `missing gemini-3.8-flash${suffix}`);
  }
  assert.equal(
    ANTIGRAVITY_PREDEFINED_MODELS.OPTIONS.some((option) => option.effort !== undefined),
    false,
  );
});

test('`agy models` TSV yields the id of every line it names', () => {
  const ids = parseAgyModelsOutput([
    'gemini-3.8-flash-high\tGemini 3.8 Flash (high)',
    'claude-sonnet-4-6\tClaude Sonnet 4.6',
  ].join('\n'));

  assert.deepEqual(ids, ['gemini-3.8-flash-high', 'claude-sonnet-4-6']);
});

test('a signed-out answer parses as an empty list, not as a model called "Please"', () => {
  // This is the literal output of a signed-out `agy models` run.
  assert.deepEqual(parseAgyModelsOutput('Please sign in to view available models.\n'), []);
});

test('a malformed line is skipped instead of taking the catalog down', () => {
  const ids = parseAgyModelsOutput([
    '',
    'Available models:',
    'gemini-3.1-pro-high\tGemini 3.1 Pro (high)',
    '   ',
    '{"not":"tsv"}',
    'gpt-oss-120b-medium',
  ].join('\r\n'));

  assert.deepEqual(ids, ['gemini-3.1-pro-high', 'gpt-oss-120b-medium']);
});

test('an empty live list leaves every catalog model selectable', () => {
  // Signed out, the live list is empty — the picker must still offer the
  // catalog rather than going blank.
  const merged = mergeLiveModelIds(ANTIGRAVITY_PREDEFINED_MODELS, []);

  assert.deepEqual(modelIds(merged), modelIds(ANTIGRAVITY_PREDEFINED_MODELS));
  assert.equal(merged.DEFAULT, ANTIGRAVITY_PREDEFINED_MODELS.DEFAULT);
});

test('a live-only model becomes visible without displacing the catalog', () => {
  const merged = mergeLiveModelIds(ANTIGRAVITY_PREDEFINED_MODELS, [
    'gemini-3.8-flash-high',
    'gemini-4-experimental',
  ]);

  const ids = modelIds(merged);
  // Catalog order is preserved and the unknown id is appended, so the picker
  // never reorders under the user between two calls.
  assert.deepEqual(ids.slice(0, ANTIGRAVITY_PREDEFINED_MODELS.OPTIONS.length), modelIds(ANTIGRAVITY_PREDEFINED_MODELS));
  assert.equal(ids.at(-1), 'gemini-4-experimental');
  assert.equal(merged.OPTIONS.at(-1)?.label, 'gemini-4-experimental');
  assert.equal(merged.OPTIONS.at(-1)?.description, 'Reported by `agy models`.');
});

test('the catalog entry wins on a shared id — a live list never renames a known model', () => {
  const merged = mergeLiveModelIds(ANTIGRAVITY_PREDEFINED_MODELS, ['claude-sonnet-4-6']);

  const sonnet = merged.OPTIONS.filter((option) => option.value === 'claude-sonnet-4-6');
  assert.equal(sonnet.length, 1, 'a live id that the catalog already has must not be listed twice');
  assert.equal(sonnet[0]?.label, 'Claude Sonnet 4.6');
});

test('a model the live list omits stays selectable, and the default never moves', () => {
  // The live list is merged into the catalog, never substituted for it: an
  // account whose list omits Opus can still pick it from the catalog.
  const merged = mergeLiveModelIds(ANTIGRAVITY_PREDEFINED_MODELS, ['gemini-3.8-flash-high']);

  assert.ok(modelIds(merged).includes('claude-opus-4-6-thinking'));
  assert.equal(merged.DEFAULT, 'gemini-3.8-flash-high');
});

test('merging repeats and unknown ids does not duplicate options or mutate the catalog', () => {
  const before = modelIds(ANTIGRAVITY_PREDEFINED_MODELS);
  const merged = mergeLiveModelIds(ANTIGRAVITY_PREDEFINED_MODELS, ['new-model', 'new-model']);

  assert.equal(modelIds(merged).filter((id) => id === 'new-model').length, 1);
  assert.deepEqual(modelIds(ANTIGRAVITY_PREDEFINED_MODELS), before, 'the shared catalog must not be mutated');
});
