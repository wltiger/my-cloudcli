import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CHAT_SPACING_LEVEL,
  getChatSpacingClasses,
  normalizeChatSpacingLevel,
} from './chatSpacing';

test('default spacing keeps today\'s mobile and desktop padding', () => {
  assert.deepEqual(getChatSpacingClasses('default'), {
    pane: 'px-4',
    row: 'px-3 sm:px-0',
  });
});

test('compact spacing shrinks the mobile padding but keeps the desktop one', () => {
  assert.deepEqual(getChatSpacingClasses('compact'), {
    pane: 'px-2 sm:px-4',
    row: 'px-1 sm:px-0',
  });
});

test('none spacing removes the mobile padding and keeps the desktop one', () => {
  assert.deepEqual(getChatSpacingClasses('none'), {
    pane: 'px-0 sm:px-4',
    row: 'px-0 sm:px-0',
  });
});

test('every level restores the same desktop padding', () => {
  for (const level of ['default', 'compact', 'none'] as const) {
    const { pane, row } = getChatSpacingClasses(level);
    assert.ok(pane === 'px-4' || pane.includes('sm:px-4'), `pane keeps 16px on desktop for "${level}"`);
    assert.ok(row.includes('sm:px-0'), `row keeps 0px on desktop for "${level}"`);
  }
});

test('unknown levels fall back to the default classes', () => {
  assert.deepEqual(
    getChatSpacingClasses('cozy' as never),
    getChatSpacingClasses(DEFAULT_CHAT_SPACING_LEVEL),
  );
});

test('normalizes stored values to a known spacing level', () => {
  assert.equal(normalizeChatSpacingLevel('compact'), 'compact');
  assert.equal(normalizeChatSpacingLevel('none'), 'none');
  assert.equal(normalizeChatSpacingLevel('default'), 'default');
});

test('normalizes missing or unknown stored values to the default level', () => {
  assert.equal(normalizeChatSpacingLevel(null), DEFAULT_CHAT_SPACING_LEVEL);
  assert.equal(normalizeChatSpacingLevel(undefined), DEFAULT_CHAT_SPACING_LEVEL);
  assert.equal(normalizeChatSpacingLevel('tight'), DEFAULT_CHAT_SPACING_LEVEL);
  assert.equal(normalizeChatSpacingLevel(3), DEFAULT_CHAT_SPACING_LEVEL);
});
