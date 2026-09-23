/**
 * Antigravity provider authentication facet — `getStatus()`.
 *
 * Verifies that sign-in state is decided solely by the live model probe rather
 * than a startup log line: non-empty model ids indicate an active session, an
 * empty list indicates signed out, and a probe failure (null) preserves the
 * unsigned-in status without crashing.
 *
 * `cross-spawn` is mocked to script the `agy models` child process and provide
 * a static `agy --version` response, ensuring deterministic execution without
 * spawning the real `agy` CLI or waiting on probe timeouts.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

type AuthModule = typeof import('@/modules/providers/list/antigravity/antigravity-auth.provider.js');
type ModelsModule = typeof import('@/modules/providers/list/antigravity/antigravity-models.provider.js');

/** What the next scripted `agy models` child does. */
type Script =
  | { kind: 'ids'; ids: string[]; delayMs?: number }
  | { kind: 'error' }
  | { kind: 'hang' };

let script: Script = { kind: 'ids', ids: [] };

const fakeChild = () => {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void };
  child.stdout = new EventEmitter();
  child.kill = () => undefined;

  const { kind } = script;
  const emit = () => {
    if (kind === 'ids') {
      child.stdout.emit('data', script.kind === 'ids' ? script.ids.map((id) => `${id}\t${id} label`).join('\n') : '');
      child.emit('close', 0);
      return;
    }
    if (kind === 'error') {
      child.emit('error', new Error('spawn ENOENT'));
    }
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

const loadModules = async (t: test.TestContext): Promise<{ auth: AuthModule; models: ModelsModule }> => {
  t.mock.module('cross-spawn', { defaultExport: spawnMock });
  const models = await import('@/modules/providers/list/antigravity/antigravity-models.provider.js');
  const auth = await import('@/modules/providers/list/antigravity/antigravity-auth.provider.js');
  return { auth, models };
};

test('scripted non-empty model ids report authenticated with cli method', { concurrency: false }, async (t) => {
  script = { kind: 'ids', ids: ['gemini-3.8-flash-high', 'gemini-4-experimental'] };
  const { auth, models } = await loadModules(t);
  await models.refreshAntigravityModelIds();

  const status = await new auth.AntigravityProviderAuth().getStatus();

  assert.equal(status.installed, true);
  assert.equal(status.provider, 'antigravity');
  assert.equal(status.authenticated, true);
  assert.equal(status.method, 'cli');
  assert.equal(status.email, null);
  assert.equal(status.error ?? null, null);
});

test('scripted empty model ids report not authenticated with AGY_NOT_SIGNED_IN error', { concurrency: false }, async (t) => {
  script = { kind: 'ids', ids: [] };
  const { auth, models } = await loadModules(t);
  await models.refreshAntigravityModelIds();

  const status = await new auth.AntigravityProviderAuth().getStatus();

  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
  assert.equal(status.method, null);
  assert.equal(status.error, auth.AGY_NOT_SIGNED_IN);
});

test('scripted spawn error reports not authenticated without crashing', { concurrency: false }, async (t) => {
  script = { kind: 'error' };
  const { auth, models } = await loadModules(t);
  await models.refreshAntigravityModelIds();

  const status = await new auth.AntigravityProviderAuth().getStatus();

  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
  assert.equal(status.method, null);
  assert.ok(typeof status.error === 'string' && status.error.length > 0, 'must report a non-empty error message');
});
