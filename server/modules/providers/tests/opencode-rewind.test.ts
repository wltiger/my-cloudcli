import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenCodeRewindAnchorIndex,
  filterOpenCodeRevertedRows,
} from '@/modules/providers/list/opencode/opencode-rewind.js';

/**
 * Seam: the same joined message/part rows `fetchHistory` reads out of
 * `opencode.db`, in the order its query returns them, plus the one extra fact a
 * Rewind adds — the `revert` state OpenCode records on the session row.
 *
 * Both rules below were measured against a real 1.18.18 server rather than read
 * from its OpenAPI document, which is wrong about this feature in two ways.
 * `POST /session/{id}/revert {messageID}` is **inclusive**: naming the user
 * message that opened the second turn of a seven-message session dropped that
 * message and everything after it, and rolled `tracked.txt` back from
 * `hello v3` to `hello v2`. And OpenCode does **not** hide what it reverted —
 * `GET /session/{id}/message` still returned all seven messages afterwards and
 * all seven rows stayed in the database, with the session row carrying
 * `revert: {messageID, snapshot, diff}`. Filtering them is CloudCLI's job.
 */

const userRow = (messageId: string, text = 'hello') => ({
  message_id: messageId,
  message_data: JSON.stringify({ id: messageId, role: 'user' }),
  part_data: JSON.stringify({ type: 'text', text }),
});

const assistantRow = (messageId: string, part: Record<string, unknown>) => ({
  message_id: messageId,
  message_data: JSON.stringify({ id: messageId, role: 'assistant' }),
  part_data: JSON.stringify(part),
});

const compactionRow = (messageId: string) => ({
  message_id: messageId,
  message_data: JSON.stringify({ id: messageId, role: 'user' }),
  part_data: JSON.stringify({ type: 'compaction', auto: false }),
});

test('a user prompt is its own Rewind Anchor, because revert drops the message it names', () => {
  // The exact opposite of the same provider's fork rule, which anchors this
  // prompt on `msg_a1` because fork *excludes* the message it is given.
  const anchors = buildOpenCodeRewindAnchorIndex([
    userRow('msg_u1'),
    assistantRow('msg_a1', { type: 'text', text: 'hi' }),
  ]);

  assert.equal(anchors.get('msg_u1'), 'msg_u1');
});

test('only the reader\'s own messages get a Rewind Anchor', () => {
  const anchors = buildOpenCodeRewindAnchorIndex([
    userRow('msg_u1', 'write hello.txt'),
    assistantRow('msg_a1', { type: 'step-start' }),
    assistantRow('msg_a1', { type: 'tool', tool: 'write', state: { status: 'completed' } }),
    assistantRow('msg_a2', { type: 'text', text: 'done' }),
    userRow('msg_u2', 'now say banana'),
  ]);

  assert.deepEqual([...anchors.keys()], ['msg_u1', 'msg_u2']);
});

test('the first prompt of a session can be rewound, unlike Claude\'s', () => {
  // Claude's rule anchors on the row *before* the message and the first prompt
  // has none, so it offers no entry. Revert names the message itself, so there
  // is no such gap here: rewinding the opening prompt simply empties the
  // session and rolls every file back with it.
  const anchors = buildOpenCodeRewindAnchorIndex([userRow('msg_u1')]);

  assert.equal(anchors.get('msg_u1'), 'msg_u1');
});

test('nothing at or before the last compaction gets a Rewind Anchor', () => {
  // Same conservative rule the fork index applies. It is load-bearing here for
  // a second reason: per ADR 0007 the filter below refuses to touch that
  // segment, so an anchor there would revert server-side and still render every
  // reverted message.
  const anchors = buildOpenCodeRewindAnchorIndex([
    userRow('msg_u1', 'before the compact'),
    assistantRow('msg_a1', { type: 'text', text: 'sure' }),
    compactionRow('msg_c1'),
    userRow('msg_u2', 'after the compact'),
    assistantRow('msg_a2', { type: 'text', text: 'ok' }),
  ]);

  assert.deepEqual([...anchors.keys()], ['msg_u2']);
});

test('a session with no revert state keeps every row', () => {
  const rows = [
    userRow('msg_u1'),
    assistantRow('msg_a1', { type: 'text', text: 'hi' }),
  ];

  assert.deepEqual(filterOpenCodeRevertedRows(rows, null), rows);
});

test('a revert drops the message it names and everything after it', () => {
  // Measured shape: revert is inclusive, and a turn spans several messages, so
  // every row of every message from the named one onwards has to go — the
  // reader must not see half a turn.
  const rows = [
    userRow('msg_u1', 'write hello v2'),
    assistantRow('msg_a1', { type: 'tool', tool: 'write', state: { status: 'completed' } }),
    assistantRow('msg_a2', { type: 'text', text: 'done' }),
    userRow('msg_u2', 'write hello v3'),
    assistantRow('msg_a3', { type: 'step-start' }),
    assistantRow('msg_a3', { type: 'tool', tool: 'write', state: { status: 'completed' } }),
    assistantRow('msg_a4', { type: 'text', text: 'done' }),
  ];

  assert.deepEqual(
    filterOpenCodeRevertedRows(rows, 'msg_u2').map((row) => row.message_id),
    ['msg_u1', 'msg_a1', 'msg_a2'],
  );
});

test('a revert naming a message that is not in the rows filters nothing', () => {
  const rows = [userRow('msg_u1'), assistantRow('msg_a1', { type: 'text', text: 'hi' })];

  assert.deepEqual(filterOpenCodeRevertedRows(rows, 'msg_gone'), rows);
});

test('a revert from before the last compaction filters nothing (ADR 0007)', () => {
  // The pre-boundary segment renders flat, marker and all. Dropping rows there
  // would take the compaction boundary and the history above it off the screen,
  // which is the worse trade of the two.
  const rows = [
    userRow('msg_u1', 'before the compact'),
    assistantRow('msg_a1', { type: 'text', text: 'sure' }),
    compactionRow('msg_c1'),
    userRow('msg_u2', 'after the compact'),
  ];

  assert.deepEqual(filterOpenCodeRevertedRows(rows, 'msg_u1'), rows);
});

test('a revert after the last compaction still filters, and keeps the boundary', () => {
  const rows = [
    userRow('msg_u1', 'before the compact'),
    compactionRow('msg_c1'),
    userRow('msg_u2', 'after the compact'),
    assistantRow('msg_a2', { type: 'text', text: 'ok' }),
    userRow('msg_u3', 'reverted'),
    assistantRow('msg_a3', { type: 'text', text: 'also reverted' }),
  ];

  assert.deepEqual(
    filterOpenCodeRevertedRows(rows, 'msg_u3').map((row) => row.message_id),
    ['msg_u1', 'msg_c1', 'msg_u2', 'msg_a2'],
  );
});
