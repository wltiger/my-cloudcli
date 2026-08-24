import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClaudeRewindAnchorIndex,
  filterClaudeAbandonedBranchRows,
} from '@/modules/providers/list/claude/claude-rewind.js';

/**
 * Seam: raw Claude transcript rows exactly as they sit in the JSONL file, in
 * file order. Both Rewind rules are decided here — which row a Rewind anchors
 * on, and which rows survive once a Rewind has turned the transcript into a
 * tree — so the fixtures are shaped after a real transcript rather than after
 * the rendered message stream.
 */

// ----------------- buildClaudeRewindAnchorIndex ------------

test('the first user prompt has no row before it, so it gets no anchor', () => {
  // resumeSessionAt is inclusive, so a Rewind anchors on the row *before* the
  // chosen message. The first prompt has none — which is also exactly why
  // Clear could not be built as a Rewind to zero.
  const anchors = buildClaudeRewindAnchorIndex([
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
  ]);

  assert.equal(anchors.has('u1'), false);
});

test('a user prompt anchors on the row before it', () => {
  const anchors = buildClaudeRewindAnchorIndex([
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'a1', parentUuid: 'u1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    { uuid: 'u2', parentUuid: 'a1', type: 'user', message: { role: 'user', content: 'again' } },
  ]);

  assert.equal(anchors.get('u2'), 'a1');
});

test('a prompt after a multi-row turn anchors on that turn\'s last row', () => {
  // One agent turn is several rows sharing `message.id`. Anchoring anywhere but
  // its last row would leave half the turn out of the resumed context.
  const anchors = buildClaudeRewindAnchorIndex([
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'a1', parentUuid: 'u1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'thinking', thinking: '...' }] } },
    { uuid: 'a2', parentUuid: 'a1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }] } },
    { uuid: 'r1', parentUuid: 'a2', type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } },
    { uuid: 'a3', parentUuid: 'r1', type: 'assistant', message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
    { uuid: 'u2', parentUuid: 'a3', type: 'user', message: { role: 'user', content: 'again' } },
  ]);

  assert.equal(anchors.get('u2'), 'a3');
});

test('a prompt whose chain parent is an attachment row anchors above it', () => {
  // Measured: a pasted image or dropped file is written as its own
  // `attachment` row directly before the prompt it belongs to. Those rows are
  // not part of the conversation the SDK resolves, so anchoring on one would
  // hand resumeSessionAt a uuid it cannot find.
  const anchors = buildClaudeRewindAnchorIndex([
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'a1', parentUuid: 'u1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    { uuid: 'x1', parentUuid: 'a1', type: 'attachment' },
    { uuid: 'u2', parentUuid: 'x1', type: 'user', message: { role: 'user', content: 'look at this' } },
  ]);

  assert.equal(anchors.get('u2'), 'a1');
});

test('a meta row is skipped both as a target and as an anchor', () => {
  const anchors = buildClaudeRewindAnchorIndex([
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'm1', parentUuid: 'u1', type: 'user', isMeta: true, message: { role: 'user', content: 'caveat' } },
    { uuid: 'u2', parentUuid: 'm1', type: 'user', message: { role: 'user', content: 'again' } },
  ]);

  assert.equal(anchors.has('m1'), false);
  assert.equal(anchors.get('u2'), 'u1');
});

test('assistant rows get no rewind anchor', () => {
  // Rewind is offered only on the reader's own messages, unlike Fork.
  const anchors = buildClaudeRewindAnchorIndex([
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'a1', parentUuid: 'u1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
  ]);

  assert.equal(anchors.has('a1'), false);
});

test('nothing at or before the last compaction boundary gets an anchor', () => {
  // An anchor from before a Compact no longer resolves at all
  // (`No message found with message.uuid of: ...`), so those messages offer no
  // entry. The first prompt after the boundary has only pre-boundary rows
  // above it, so it gets none either.
  const anchors = buildClaudeRewindAnchorIndex([
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'a1', parentUuid: 'u1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    { uuid: 'u2', parentUuid: 'a1', type: 'user', message: { role: 'user', content: 'second' } },
    { uuid: 'cb1', parentUuid: 'u2', type: 'system', subtype: 'compact_boundary' },
    { uuid: 'u3', parentUuid: 'cb1', type: 'user', message: { role: 'user', content: 'third' } },
    { uuid: 'a3', parentUuid: 'u3', type: 'assistant', message: { id: 'msg_3', role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    { uuid: 'u4', parentUuid: 'a3', type: 'user', message: { role: 'user', content: 'fourth' } },
  ]);

  assert.equal(anchors.has('u1'), false);
  assert.equal(anchors.has('u2'), false);
  // First prompt after the boundary: every row above it is unaddressable.
  assert.equal(anchors.has('u3'), false);
  assert.equal(anchors.get('u4'), 'a3');
});

// ----------------- filterClaudeAbandonedBranchRows ------------

test('a rewound transcript drops the abandoned branch and keeps the new one', () => {
  // Measured: a Rewind appends the new turn to the same file with its
  // parentUuid pointing back at the anchor, so both branches are physically
  // present and a flat reader keeps rendering the abandoned one.
  const rows = [
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'a1', parentUuid: 'u1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    { uuid: 'u2', parentUuid: 'a1', type: 'user', message: { role: 'user', content: 'wrong question' } },
    { uuid: 'a2', parentUuid: 'u2', type: 'assistant', message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'wrong answer' }] } },
    // Rewind anchored at a1: the new prompt hangs off a1, not off a2.
    { uuid: 'u3', parentUuid: 'a1', type: 'user', message: { role: 'user', content: 'better question' } },
    { uuid: 'a3', parentUuid: 'u3', type: 'assistant', message: { id: 'msg_3', role: 'assistant', content: [{ type: 'text', text: 'better answer' }] } },
  ];

  const kept = filterClaudeAbandonedBranchRows(rows, new Set(['u1', 'a1', 'u3', 'a3']));

  assert.deepEqual(kept.map((row) => row.uuid), ['u1', 'a1', 'u3', 'a3']);
});

test('everything at or before the last compaction boundary is kept unfiltered', () => {
  // ADR 0007: the SDK's branch reader also discards everything before a
  // compaction boundary, which would take the boundary marker and the history
  // above it off the screen. A Rewind anchor from before a Compact cannot
  // resolve, so no abandoned branch can exist there — the filter is applied
  // only to the segment after the last boundary.
  const rows = [
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'a1', parentUuid: 'u1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    { uuid: 'cb1', parentUuid: 'a1', type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'manual', preTokens: 100, postTokens: 10 } },
    { uuid: 'u2', parentUuid: 'cb1', type: 'user', message: { role: 'user', content: 'wrong question' } },
    { uuid: 'a2', parentUuid: 'u2', type: 'assistant', message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'wrong answer' }] } },
    { uuid: 'u3', parentUuid: 'cb1', type: 'user', message: { role: 'user', content: 'better question' } },
    { uuid: 'a3', parentUuid: 'u3', type: 'assistant', message: { id: 'msg_3', role: 'assistant', content: [{ type: 'text', text: 'better answer' }] } },
  ];

  // What the SDK reports as the active branch: it drops the pre-boundary rows.
  const kept = filterClaudeAbandonedBranchRows(rows, new Set(['u3', 'a3']));

  assert.deepEqual(kept.map((row) => row.uuid), ['u1', 'a1', 'cb1', 'u3', 'a3']);
});

test('rows the branch reader never returns are kept', () => {
  // The SDK returns only user/assistant rows, and drops meta and sidechain
  // ones. Their absence from the active set says nothing about which branch
  // they are on, so treating it as "abandoned" would silently delete the
  // reader's attachments and subagent output.
  const rows = [
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { type: 'ai-title', title: 'A chat' },
    { uuid: 'x1', parentUuid: 'u1', type: 'attachment' },
    { uuid: 'm1', parentUuid: 'u1', type: 'user', isMeta: true, message: { role: 'user', content: 'caveat' } },
    { uuid: 's1', parentUuid: 'u1', type: 'assistant', isSidechain: true, message: { id: 'msg_s', role: 'assistant', content: [] } },
    { uuid: 'a1', parentUuid: 'u1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
  ];

  const kept = filterClaudeAbandonedBranchRows(rows, new Set(['u1', 'a1']));

  assert.deepEqual(kept.map((row) => row.uuid ?? row.type), ['u1', 'ai-title', 'x1', 'm1', 's1', 'a1']);
});

test('an empty active branch filters nothing', () => {
  // The reader losing their whole conversation because the branch read failed
  // is far worse than an abandoned branch staying visible.
  const rows = [
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'a1', parentUuid: 'u1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
  ];

  assert.deepEqual(filterClaudeAbandonedBranchRows(rows, new Set()), rows);
});
