import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForkSessionName } from '@/modules/providers/services/session-fork.service.js';

// Seam: this is the name the Fork dialog opens pre-filled with. The reader can
// still edit it, so these only pin the starting point.

test('a fork is named after the session it came from', () => {
  assert.equal(buildForkSessionName('Wire up the sidebar', []), '[Fork] Wire up the sidebar');
});

test('an already-taken name gets a sequence number', () => {
  assert.equal(
    buildForkSessionName('Wire up the sidebar', ['Wire up the sidebar', '[Fork] Wire up the sidebar']),
    '[Fork] Wire up the sidebar (2)',
  );
});

test('the sequence continues past every taken number', () => {
  assert.equal(
    buildForkSessionName('Retry', ['[Fork] Retry', '[Fork] Retry (2)', '[Fork] Retry (3)']),
    '[Fork] Retry (4)',
  );
});

test('a gap in the sequence is filled rather than skipped', () => {
  assert.equal(
    buildForkSessionName('Retry', ['[Fork] Retry', '[Fork] Retry (3)']),
    '[Fork] Retry (2)',
  );
});

test('forking a fork nests rather than replacing the prefix', () => {
  assert.equal(buildForkSessionName('[Fork] Retry', []), '[Fork] [Fork] Retry');
});

test('an unnamed session still produces a usable name', () => {
  assert.equal(buildForkSessionName('', []), '[Fork] Untitled Session');
  assert.equal(buildForkSessionName('   ', []), '[Fork] Untitled Session');
});

test('surrounding whitespace never makes a taken name look free', () => {
  assert.equal(
    buildForkSessionName('  Retry  ', ['  [Fork] Retry  ']),
    '[Fork] Retry (2)',
  );
});
