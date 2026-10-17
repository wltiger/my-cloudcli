import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readDeclaredContextWindow,
  resolveContextWindowTotal,
} from '@/modules/providers/services/claude-context-window.js';
import { summarizeClaudeTokenUsage } from '@/modules/providers/services/provider-token-usage.service.js';
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

test('a declared window outranks the reported window, the server-level window and the default', () => {
  withServerContextWindow('180000', () => {
    assert.equal(resolveContextWindowTotal({ declared: 262_144, reported: 200_000 }), 262_144);
  });
  withServerContextWindow(undefined, () => {
    assert.equal(resolveContextWindowTotal({ declared: 262_144 }), 262_144);
  });
});

test('with no declaration, the window the SDK reported outranks the server-level window', () => {
  withServerContextWindow('180000', () => {
    assert.equal(resolveContextWindowTotal({ declared: null, reported: 1_000_000 }), 1_000_000);
  });
});

test('an unusable reported window is skipped, not shown', () => {
  withServerContextWindow('180000', () => {
    assert.equal(resolveContextWindowTotal({ reported: 0 }), 180_000);
    assert.equal(resolveContextWindowTotal({ reported: Number.NaN }), 180_000);
  });
});

test('no declaration and no report falls back to the server-level window', () => {
  withServerContextWindow('180000', () => {
    assert.equal(resolveContextWindowTotal({ declared: null, reported: null }), 180_000);
    assert.equal(resolveContextWindowTotal({}), 180_000);
  });
});

test('no declaration, no report and no server-level window falls back to the 160K default', () => {
  withServerContextWindow(undefined, () => {
    assert.equal(resolveContextWindowTotal({ declared: null }), 160_000);
  });
});

test('an unusable server-level window falls back to the 160K default', () => {
  // Pre-existing deployments may carry an empty or junk value; neither should
  // ever produce a zero/NaN total, which would hide the readout line entirely.
  withServerContextWindow('', () => {
    assert.equal(resolveContextWindowTotal({ declared: null }), 160_000);
  });
  withServerContextWindow('not-a-number', () => {
    assert.equal(resolveContextWindowTotal({ declared: null }), 160_000);
  });
  withServerContextWindow('0', () => {
    assert.equal(resolveContextWindowTotal({ declared: null }), 160_000);
  });
});

test('the caller may pass the server-level window explicitly instead of reading the environment', () => {
  withServerContextWindow('180000', () => {
    assert.equal(resolveContextWindowTotal({ declared: null, configured: '200000' }), 200_000);
  });
});

test('the usage summary applies the same order to both windows it is given', () => {
  const entries = [{ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5 } } }];
  withServerContextWindow('180000', () => {
    assert.equal(
      summarizeClaudeTokenUsage(entries, '180000', { declaredContextWindow: 262_144, reportedContextWindow: 200_000 }).total,
      262_144,
    );
    assert.equal(
      summarizeClaudeTokenUsage(entries, '180000', { declaredContextWindow: null, reportedContextWindow: 200_000 }).total,
      200_000,
    );
    assert.equal(summarizeClaudeTokenUsage(entries, '180000').total, 180_000);
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
