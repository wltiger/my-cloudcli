import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCODE_SESSION_END_ANCHOR,
  buildOpenCodeAnchorIndex,
} from '@/modules/providers/list/opencode/opencode-anchors.js';

/**
 * Seam: these are the joined message/part rows `fetchHistory` already reads out
 * of `opencode.db`, in the order its query returns them. Every fixture below is
 * shaped after a real 1.18.18 session, because OpenCode's fork is **exclusive**
 * — it drops the message it is given — and nothing about that is derivable from
 * the rendered message stream.
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

test('a user prompt anchors on the message that answers it, because fork drops the named message', () => {
  // Anchoring the prompt on itself would fork a session that stops *before* it.
  const anchors = buildOpenCodeAnchorIndex([
    userRow('msg_u1'),
    assistantRow('msg_a1', { type: 'text', text: 'hi' }),
  ]);

  assert.equal(anchors.get('msg_u1'), 'msg_a1');
});

test("every message of one agent turn anchors on the next turn's first message", () => {
  // Measured shape: a turn that wrote a file came back as *two* assistant
  // messages — one carrying the tool call, one carrying the reply text. Fork is
  // exclusive, so the tool-call message must anchor past the reply text, not on
  // it: naming the reply text would drop it and truncate the turn.
  const anchors = buildOpenCodeAnchorIndex([
    userRow('msg_u1', 'write hello.txt'),
    assistantRow('msg_a1', { type: 'step-start' }),
    assistantRow('msg_a1', { type: 'tool', tool: 'write', state: { status: 'completed' } }),
    assistantRow('msg_a2', { type: 'text', text: 'done' }),
    userRow('msg_u2', 'now say banana'),
    assistantRow('msg_a3', { type: 'text', text: 'banana' }),
  ]);

  assert.equal(anchors.get('msg_a1'), 'msg_u2');
  assert.equal(anchors.get('msg_a2'), 'msg_u2');
  // The prompt that opened the turn is a turn of its own and stops at itself.
  assert.equal(anchors.get('msg_u1'), 'msg_a1');
  assert.equal(anchors.get('msg_u2'), 'msg_a3');
});

test('the last turn anchors on the end of the session, which fork copies whole', () => {
  // Nothing follows the newest turn, so there is no message to name. OpenCode's
  // fork copies the whole session when it is sent no message at all, which is
  // exactly "ends at the last turn" — so the newest messages stay forkable.
  const anchors = buildOpenCodeAnchorIndex([
    userRow('msg_u1'),
    assistantRow('msg_a1', { type: 'tool', tool: 'read', state: { status: 'completed' } }),
    assistantRow('msg_a2', { type: 'text', text: 'done' }),
  ]);

  assert.equal(anchors.get('msg_a1'), OPENCODE_SESSION_END_ANCHOR);
  assert.equal(anchors.get('msg_a2'), OPENCODE_SESSION_END_ANCHOR);
});

test('messages at or before the last compaction get no anchor', () => {
  // Same conservative rule Claude's index applies: an anchor from before a
  // Compact is not something this fork is willing to hand out.
  const anchors = buildOpenCodeAnchorIndex([
    userRow('msg_old1', 'ancient'),
    assistantRow('msg_old2', { type: 'text', text: 'ancient reply' }),
    compactionRow('msg_c1'),
    assistantRow('msg_sum', { type: 'text', text: 'summary' }),
    userRow('msg_u1', 'after'),
    assistantRow('msg_a1', { type: 'text', text: 'ok' }),
  ]);

  assert.equal(anchors.has('msg_old1'), false);
  assert.equal(anchors.has('msg_old2'), false);
  assert.equal(anchors.has('msg_c1'), false);
  assert.equal(anchors.get('msg_sum'), 'msg_u1');
  assert.equal(anchors.get('msg_u1'), 'msg_a1');
});

test('only the last compaction matters', () => {
  const anchors = buildOpenCodeAnchorIndex([
    compactionRow('msg_c1'),
    userRow('msg_mid', 'between compactions'),
    compactionRow('msg_c2'),
    userRow('msg_u1', 'after'),
    assistantRow('msg_a1', { type: 'text', text: 'ok' }),
  ]);

  assert.equal(anchors.has('msg_mid'), false);
  assert.equal(anchors.get('msg_u1'), 'msg_a1');
});

test('a message whose parts were never written still takes part in the turn rule', () => {
  // The history query LEFT JOINs parts, so a message with none comes back as a
  // single row carrying a null part.
  const anchors = buildOpenCodeAnchorIndex([
    userRow('msg_u1'),
    { message_id: 'msg_a1', message_data: JSON.stringify({ role: 'assistant' }), part_data: null },
    userRow('msg_u2', 'again'),
  ]);

  assert.equal(anchors.get('msg_u1'), 'msg_a1');
  assert.equal(anchors.get('msg_a1'), 'msg_u2');
  assert.equal(anchors.get('msg_u2'), OPENCODE_SESSION_END_ANCHOR);
});
