import assert from 'node:assert/strict';

import { test } from 'vitest';

import { getToolConfig } from '@/modules/chat/tools/configs/toolConfigs';

// Regression coverage: the SDK never writes the user's answer back onto the
// AskUserQuestion tool_use's own `input` — it's recorded separately on the
// paired tool_result's `toolUseResult.answers` (see claude-sessions.provider.ts).
// Once the live optimistic `updatedInput` is gone (page reload, reopened
// session), history must fall back to the tool_result to avoid showing every
// answered question as "Skipped".

test('AskUserQuestion getContentProps falls back to toolResult.toolUseResult.answers', () => {
  const config = getToolConfig('AskUserQuestion');
  const input = { questions: [{ question: 'Pick one?', options: [{ label: 'A' }] }] };
  const toolResult = { toolUseResult: { answers: { 'Pick one?': 'A' } } };

  const props = config.input.getContentProps?.(input, { toolResult });

  assert.deepEqual(props.answers, { 'Pick one?': 'A' });
});

test('AskUserQuestion getContentProps prefers input.answers over toolResult when both present', () => {
  const config = getToolConfig('AskUserQuestion');
  const input = { questions: [{ question: 'Pick one?' }], answers: { 'Pick one?': 'live-optimistic' } };
  const toolResult = { toolUseResult: { answers: { 'Pick one?': 'stale' } } };

  const props = config.input.getContentProps?.(input, { toolResult });

  assert.deepEqual(props.answers, { 'Pick one?': 'live-optimistic' });
});

test('AskUserQuestion getContentProps returns empty answers when neither source has one', () => {
  const config = getToolConfig('AskUserQuestion');
  const input = { questions: [{ question: 'Pick one?' }] };

  const props = config.input.getContentProps?.(input, {});

  assert.deepEqual(props.answers, {});
});

test('AskUserQuestion title reflects the answer from toolResult.toolUseResult.answers', () => {
  const config = getToolConfig('AskUserQuestion');
  const input = { questions: [{ question: 'Pick one?', header: 'H' }] };
  const toolResult = { toolUseResult: { answers: { 'Pick one?': 'A' } } };
  const title = config.input.title as (input: unknown, context?: unknown) => string;

  assert.equal(title(input, { toolResult }), 'H — A');
});

test('AskUserQuestion title stays unanswered with no answer anywhere', () => {
  const config = getToolConfig('AskUserQuestion');
  const input = { questions: [{ question: 'Pick one?', header: 'H' }] };
  const title = config.input.title as (input: unknown, context?: unknown) => string;

  assert.equal(title(input, {}), 'H');
});
