/**
 * Antigravity live model catalog — the cache behind `agy models`.
 *
 * `antigravity-models.test.ts` covers the pure merge helpers; this file covers
 * the cache itself, which is where the one bug worth guarding against lives: a
 * failed probe (`null` = could not run) used to be cached as an empty list, and
 * an empty list is exactly what a signed-out `agy models` answers — so one
 * unreachable CLI read as five minutes of "not signed in".
 *
 * Nothing here spawns `agy`: `cross-spawn` is mocked, so "the probe ran" is
 * scripted and the child count is counted rather than inferred.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

type ModelsModule = typeof import('@/modules/providers/list/antigravity/antigravity-models.provider.js');

/** What the next scripted `agy models` child does. */
type Script =
  | { kind: 'ids'; ids: string[]; delayMs?: number }
  | { kind: 'error' }
  | { kind: 'hang' };

let script: Script = { kind: 'ids', ids: [] };
let spawnCalls = 0;

const fakeChild = () => {
  spawnCalls += 1;

  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void };
  child.stdout = new EventEmitter();
  child.kill = () => undefined;

  const { kind } = script;
  // Deferred so the caller can attach its listeners before anything fires.
  const emit = () => {
    if (kind === 'ids') {
      child.stdout.emit('data', script.kind === 'ids' ? script.ids.map((id) => `${id}\t${id} label`).join('\n') : '');
      child.emit('close', 0);
      return;
    }
    if (kind === 'error') {
      // A CLI that never starts: `error`, then nothing.
      child.emit('error', new Error('spawn ENOENT'));
    }
    // 'hang' settles on nothing — only the probe's own 15 s kill timer ends it.
  };

  const delayMs = script.kind === 'ids' ? script.delayMs ?? 0 : 0;
  if (delayMs > 0) {
    setTimeout(emit, delayMs);
  } else {
    setImmediate(emit);
  }

  return child;
};

// `cross-spawn`'s default export is the spawn function; `sync` serves the
// auth facet's `agy --version` probe.
const spawnMock = Object.assign(() => fakeChild(), {
  sync: () => ({ status: 0, stdout: 'agy 1.2.8' }),
});

/**
 * Imports the models facet with `cross-spawn` mocked.
 *
 * Only the first call in this file instantiates the module — later calls reuse
 * it, which is why every test drives the same scripted child through the
 * mutable `script` above rather than through a new mock.
 */
const loadModels = async (t: test.TestContext): Promise<ModelsModule> => {
  t.mock.module('cross-spawn', { defaultExport: spawnMock });
  return import('@/modules/providers/list/antigravity/antigravity-models.provider.js');
};

const optionValues = (models: { OPTIONS: Array<{ value: string }> }): string[] =>
  models.OPTIONS.map((option) => option.value);

test('a failed probe leaves no answer in the cache, not a signed-out one', { concurrency: false }, async (t) => {
  script = { kind: 'error' };
  const models = await loadModels(t);

  const catalog = await models.refreshAntigravityModelIds();

  // The whole point: `null`, never `[]`. An empty list here is the signed-out
  // answer, and the cache is served as-is for the next five minutes.
  assert.equal(catalog?.ids ?? null, null, 'a failed probe must not be cached as an empty list');
  assert.equal(
    models.readFreshAntigravityModelIds(),
    null,
    'a fresh read after a failed probe must report no answer, not "signed out"',
  );

  // The picker degrades to the static catalog rather than going blank.
  const supported = await new models.AntigravityProviderModels().getSupportedModels();
  assert.deepEqual(optionValues(supported), optionValues(models.ANTIGRAVITY_PREDEFINED_MODELS));
  assert.equal(supported.DEFAULT, models.ANTIGRAVITY_PREDEFINED_MODELS.DEFAULT);
});

test('a successful probe is cached and merged into the static catalog', { concurrency: false }, async (t) => {
  script = { kind: 'ids', ids: ['gemini-3.8-flash-high', 'gemini-4-experimental'] };
  const models = await loadModels(t);

  const catalog = await models.refreshAntigravityModelIds();

  assert.deepEqual(catalog?.ids, ['gemini-3.8-flash-high', 'gemini-4-experimental']);
  assert.deepEqual(
    models.readFreshAntigravityModelIds(),
    ['gemini-3.8-flash-high', 'gemini-4-experimental'],
    'a successful probe is what the auth facet then reads for free',
  );

  const ids = optionValues(await new models.AntigravityProviderModels().getSupportedModels());
  const staticIds = optionValues(models.ANTIGRAVITY_PREDEFINED_MODELS);
  assert.deepEqual(ids.slice(0, staticIds.length), staticIds, 'the catalog must not be reordered or dropped');
  assert.equal(ids.at(-1), 'gemini-4-experimental', 'a live-only model becomes selectable');
});

test('concurrent refreshes coalesce onto one `agy models` child', { concurrency: false }, async (t) => {
  script = { kind: 'ids', ids: ['gemini-3.8-flash-high'], delayMs: 50 };
  const models = await loadModels(t);
  spawnCalls = 0;

  const [first, second] = await Promise.all([
    models.refreshAntigravityModelIds(),
    models.refreshAntigravityModelIds(),
  ]);

  assert.equal(spawnCalls, 1, 'two concurrent refresh callers must share one probe child');
  assert.equal(first, second, 'both callers must be handed the same cached result');
  assert.deepEqual(first?.ids, ['gemini-3.8-flash-high']);
});
