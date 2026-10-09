import assert from 'node:assert/strict';
import test from 'node:test';

import { extractClaudeEventModel, CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';

const SESSION_ID = 'session-1';

test('ignores the <synthetic> placeholder Claude Code stamps on synthesized rows', () => {
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { model: '<synthetic>' } },
      SESSION_ID,
    ),
    null,
  );
  assert.equal(
    extractClaudeEventModel({ sessionId: SESSION_ID, model: '<synthetic>' }, SESSION_ID),
    null,
  );
});

test('still surfaces real model ids from message and event fields', () => {
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { model: 'claude-sonnet-5' } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
  assert.equal(
    extractClaudeEventModel({ sessionId: SESSION_ID, model: 'opus' }, SESSION_ID),
    'opus',
  );
});

test('skips a placeholder content part so a later real model tag still wins', () => {
  assert.equal(
    extractClaudeEventModel(
      {
        sessionId: SESSION_ID,
        message: {
          content: [
            { text: '<model><synthetic></model>' },
            { text: '<model>claude-sonnet-5</model>' },
          ],
        },
      },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('a placeholder stdout hit does not shadow a real <model> tag in the same text', () => {
  const text = '<local-command-stdout>Set model to <synthetic></local-command-stdout>'
    + '<model>claude-sonnet-5</model>';
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { content: text } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { content: [{ text }] } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('falls back to the message model when every content hit is a placeholder', () => {
  assert.equal(
    extractClaudeEventModel(
      {
        sessionId: SESSION_ID,
        message: {
          content: '<model><synthetic></model>',
          model: 'claude-sonnet-5',
        },
      },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

// `resolveClaudeEffort` sends a model's `effort.default` only when the tier is
// also in that model's `values`; a default outside its own list fails the
// whitelist and silently falls back to the SDK's own effort. Catalog entries are
// hand-edited, so this is the invariant that keeps a typo from turning a chosen
// default into no default at all.
test('every catalog entry declares an effort default its own values allow', () => {
  const withEffort = CLAUDE_PREDEFINED_MODELS.OPTIONS.filter((option) => option.effort);

  // Guards against the assertion silently passing if the effort blocks are ever
  // dropped wholesale.
  assert.ok(withEffort.length > 0, 'expected at least one catalog entry to declare an effort block');

  for (const option of withEffort) {
    const allowed = option.effort?.values.map((value) => value.value) ?? [];
    assert.ok(
      allowed.includes(option.effort?.default ?? ''),
      `${option.value}: default "${option.effort?.default}" is not one of its own values [${allowed.join(', ')}]`,
    );
  }
});
