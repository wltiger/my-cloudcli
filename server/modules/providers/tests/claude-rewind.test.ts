import assert from 'node:assert/strict';
import test from 'node:test';

import { filterClaudeAbandonedBranchRows } from '@/modules/providers/list/claude/claude-rewind.js';

/**
 * Seam: raw Claude transcript rows exactly as they sit in the JSONL file, in
 * file order. Editing a message re-runs the conversation from an earlier row,
 * which turns the transcript into a tree; the rule decided here is which rows
 * survive that. The fixtures are shaped after a real transcript rather than
 * after the rendered message stream.
 */

// ----------------- filterClaudeAbandonedBranchRows ------------

test('a rewound transcript drops the abandoned branch and keeps the new one', () => {
  // Measured: an edit appends the replacement turn to the same file with its
  // parentUuid pointing back at the anchor, so both branches are physically
  // present and a flat reader keeps rendering the abandoned one.
  const rows = [
    { uuid: 'u1', parentUuid: null, type: 'user', message: { role: 'user', content: 'hello' } },
    { uuid: 'a1', parentUuid: 'u1', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    { uuid: 'u2', parentUuid: 'a1', type: 'user', message: { role: 'user', content: 'wrong question' } },
    { uuid: 'a2', parentUuid: 'u2', type: 'assistant', message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'wrong answer' }] } },
    // Resumed through a1: the replacement prompt hangs off a1, not off a2.
    { uuid: 'u3', parentUuid: 'a1', type: 'user', message: { role: 'user', content: 'better question' } },
    { uuid: 'a3', parentUuid: 'u3', type: 'assistant', message: { id: 'msg_3', role: 'assistant', content: [{ type: 'text', text: 'better answer' }] } },
  ];

  const kept = filterClaudeAbandonedBranchRows(rows, new Set(['u1', 'a1', 'u3', 'a3']));

  assert.deepEqual(kept.map((row) => row.uuid), ['u1', 'a1', 'u3', 'a3']);
});

test('everything at or before the last compaction boundary is kept unfiltered', () => {
  // ADR 0007: the SDK's branch reader also discards everything before a
  // compaction boundary, which would take the boundary marker and the history
  // above it off the screen. A resume anchor from before a Compact cannot
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
