import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const SESSION_ID = 'session-1';

const SKILL_BODY = [
  'Base directory for this skill: /tmp/claude/bundled-skills/2.1.220/abc123/claude-api',
  '',
  '# Building LLM-Powered Applications with Claude',
  '',
  'This skill helps you build LLM-powered applications with Claude.',
].join('\n');

test('claude: injected skill bodies are hidden even without the isMeta flag', () => {
  const provider = new ClaudeSessionsProvider();

  // The live SDK stream omits `isMeta`, so the payload has to be recognised by
  // its content or it renders as a giant user bubble mid-run.
  const live = provider.normalizeMessage(
    {
      uuid: 'u1',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
    },
    SESSION_ID,
  );
  assert.deepEqual(live, []);

  const persisted = provider.normalizeMessage(
    {
      uuid: 'u2',
      timestamp: '2026-07-28T10:00:00.000Z',
      isMeta: true,
      message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
    },
    SESSION_ID,
  );
  assert.deepEqual(persisted, []);
});

test('claude: the Skill tool result itself still reaches the UI', () => {
  const provider = new ClaudeSessionsProvider();

  const messages = provider.normalizeMessage(
    {
      uuid: 'u3',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Launching skill: claude-api' }],
      },
    },
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_result');
  assert.equal(messages[0].toolId, 'toolu_1');
});

test('claude: a live compaction boundary normalizes with trigger and before/after token counts', () => {
  const provider = new ClaudeSessionsProvider();

  // Shape emitted by the Claude Agent SDK query stream: snake_case metadata keys.
  const messages = provider.normalizeMessage(
    {
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'manual',
        pre_tokens: 32655,
        post_tokens: 3031,
        cumulative_dropped_tokens: 29624,
        duration_ms: 19860,
        preserved_segment: {},
      },
      uuid: 'u4',
      session_id: SESSION_ID,
    },
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'compact_boundary');
  assert.equal(messages[0].compactTrigger, 'manual');
  assert.equal(messages[0].compactPreTokens, 32655);
  assert.equal(messages[0].compactPostTokens, 3031);
});

test('claude: the same boundary read from history (camelCase) normalizes to the same shape', () => {
  const provider = new ClaudeSessionsProvider();

  // Shape persisted to the JSONL transcript row: camelCase metadata keys.
  const messages = provider.normalizeMessage(
    {
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Conversation compacted',
      level: 'info',
      isMeta: false,
      timestamp: '2026-07-28T10:05:00.000Z',
      uuid: 'u5',
      parentUuid: null,
      logicalParentUuid: 'u4',
      compactMetadata: {
        trigger: 'auto',
        preTokens: 934861,
        postTokens: 5000,
        cumulativeDroppedTokens: 929861,
        durationMs: 21000,
        preservedMessages: 4,
        preservedSegment: {},
      },
    },
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'compact_boundary');
  assert.equal(messages[0].compactTrigger, 'auto');
  assert.equal(messages[0].compactPreTokens, 934861);
  assert.equal(messages[0].compactPostTokens, 5000);
});

test('claude: an unrelated system event still produces nothing', () => {
  const provider = new ClaudeSessionsProvider();

  const messages = provider.normalizeMessage(
    {
      type: 'system',
      subtype: 'init',
      uuid: 'u6',
      session_id: SESSION_ID,
    },
    SESSION_ID,
  );

  assert.deepEqual(messages, []);
});
