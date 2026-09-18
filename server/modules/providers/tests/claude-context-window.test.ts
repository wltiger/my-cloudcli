import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readDeclaredContextWindow,
  resolveContextWindowTotal,
} from '@/modules/providers/services/claude-context-window.js';
import type { ProviderModelsDefinition } from '@/shared/types.js';

/** Runs `body` with CONTEXT_WINDOW forced to `value` (or unset), then restores it. */
function withServerContextWindow(value: string | undefined, body: () => void): void {
  const previous = process.env.CONTEXT_WINDOW;
  if (value === undefined) {
    delete process.env.CONTEXT_WINDOW;
  } else {
    process.env.CONTEXT_WINDOW = value;
  }
  try {
    body();
  } finally {
    if (previous === undefined) {
      delete process.env.CONTEXT_WINDOW;
    } else {
      process.env.CONTEXT_WINDOW = previous;
    }
  }
}

test('a declared window outranks the server-level window and the default', () => {
  withServerContextWindow('180000', () => {
    assert.equal(resolveContextWindowTotal(262_144), 262_144);
  });
  withServerContextWindow(undefined, () => {
    assert.equal(resolveContextWindowTotal(262_144), 262_144);
  });
});

test('no declaration falls back to the server-level window', () => {
  withServerContextWindow('180000', () => {
    assert.equal(resolveContextWindowTotal(null), 180_000);
    assert.equal(resolveContextWindowTotal(undefined), 180_000);
  });
});

test('no declaration and no server-level window falls back to the 160K default', () => {
  withServerContextWindow(undefined, () => {
    assert.equal(resolveContextWindowTotal(null), 160_000);
  });
});

test('an unusable server-level window falls back to the 160K default', () => {
  // Pre-existing deployments may carry an empty or junk value; neither should
  // ever produce a zero/NaN total, which would hide the readout line entirely.
  withServerContextWindow('', () => {
    assert.equal(resolveContextWindowTotal(null), 160_000);
  });
  withServerContextWindow('not-a-number', () => {
    assert.equal(resolveContextWindowTotal(null), 160_000);
  });
  withServerContextWindow('0', () => {
    assert.equal(resolveContextWindowTotal(null), 160_000);
  });
});

test('the caller may pass the server-level window explicitly instead of reading the environment', () => {
  withServerContextWindow('180000', () => {
    assert.equal(resolveContextWindowTotal(null, '200000'), 200_000);
  });
});

const CATALOG: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'default', label: 'Default' },
    { value: 'plain-model', label: 'Plain custom model', isCustom: true },
    { value: 'window-model', label: 'Window model', isCustom: true, contextWindow: 262_144 },
  ],
  DEFAULT: 'default',
};

test('the catalog lookup reads a declared window and nothing else', () => {
  assert.equal(readDeclaredContextWindow('window-model', CATALOG), 262_144);
  assert.equal(readDeclaredContextWindow('plain-model', CATALOG), null);
  assert.equal(readDeclaredContextWindow('default', CATALOG), null);
  assert.equal(readDeclaredContextWindow('not-in-catalog', CATALOG), null);
  assert.equal(readDeclaredContextWindow(undefined, CATALOG), null);
});
