import assert from 'node:assert/strict';
import test from 'node:test';

import { buildClaudeAnchorIndex } from '@/modules/providers/list/claude/claude-anchors.js';

/**
 * Seam: these are raw Claude transcript rows exactly as they sit in the JSONL
 * file, in file order. Everything the Fork entry point depends on is decided
 * here, so the fixtures below are shaped after a real transcript rather than
 * after the rendered message stream.
 */

test('a user prompt is one transcript row, so it anchors on itself', () => {
  const anchors = buildClaudeAnchorIndex([
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
  ]);

  assert.equal(anchors.get('u1'), 'u1');
});

test('every row of one agent turn anchors on that turn\'s last row', () => {
  // Claude writes one API message as several rows sharing `message.id`:
  // reasoning, text, one per tool call. forkSession is inclusive, so anchoring
  // any of them at the first row would silently drop the rest of the turn.
  const anchors = buildClaudeAnchorIndex([
    { uuid: 'u1', type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'a1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'thinking', thinking: '...' }] } },
    { uuid: 'a2', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'on it' }] } },
    { uuid: 'a3', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }] } },
  ]);

  assert.equal(anchors.get('a1'), 'a3');
  assert.equal(anchors.get('a2'), 'a3');
  assert.equal(anchors.get('a3'), 'a3');
  // The user row is its own turn and is unaffected by the turn that follows.
  assert.equal(anchors.get('u1'), 'u1');
});

test('a turn whose rows are interleaved with tool results still anchors on its last row', () => {
  // Measured shape: one assistant message issuing two tool calls has each
  // tool_result row written between its two tool_use rows, so the rows sharing
  // a `message.id` are not consecutive.
  const anchors = buildClaudeAnchorIndex([
    { uuid: 'a1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }] } },
    { uuid: 'r1', type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } },
    { uuid: 'm1', type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>' }] } },
    { uuid: 'a2', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Grep', input: {} }] } },
  ]);

  assert.equal(anchors.get('a1'), 'a2');
  assert.equal(anchors.get('a2'), 'a2');
  // Rows that belong to no agent turn keep anchoring on themselves.
  assert.equal(anchors.get('r1'), 'r1');
  assert.equal(anchors.get('m1'), 'm1');
});

test('rows at or before the last compaction boundary get no anchor', () => {
  // A resume anchor from before a Compact is known to fail hard, and Fork's
  // tolerance was never measured, so both stay conservative: no anchor at all.
  const anchors = buildClaudeAnchorIndex([
    { uuid: 'old1', type: 'user', message: { role: 'user', content: 'ancient' } },
    { uuid: 'old2', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'ancient reply' }] } },
    { uuid: 'b1', type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'manual' } },
    { uuid: 'sum', type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary' } },
    { uuid: 'new1', type: 'user', message: { role: 'user', content: 'after' } },
  ]);

  assert.equal(anchors.has('old1'), false);
  assert.equal(anchors.has('old2'), false);
  assert.equal(anchors.has('b1'), false);
  assert.equal(anchors.get('sum'), 'sum');
  assert.equal(anchors.get('new1'), 'new1');
});

test('only the last compaction boundary matters', () => {
  const anchors = buildClaudeAnchorIndex([
    { uuid: 'b1', type: 'system', subtype: 'compact_boundary' },
    { uuid: 'mid', type: 'user', message: { role: 'user', content: 'between boundaries' } },
    { uuid: 'b2', type: 'system', subtype: 'compact_boundary' },
    { uuid: 'new1', type: 'user', message: { role: 'user', content: 'after' } },
  ]);

  assert.equal(anchors.has('mid'), false);
  assert.equal(anchors.get('new1'), 'new1');
});

test('rows without a usable uuid are skipped instead of throwing', () => {
  // `ai-title`, `last-prompt` and `queue-operation` rows share the transcript
  // file but carry no uuid at all.
  const anchors = buildClaudeAnchorIndex([
    { type: 'ai-title', title: 'Some session' },
    { uuid: '', type: 'queue-operation' },
    { uuid: 'u1', type: 'user', message: { role: 'user', content: 'hello' } },
  ]);

  assert.equal(anchors.size, 1);
  assert.equal(anchors.get('u1'), 'u1');
});
