import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import { getToolConfig } from '@/modules/chat/tools/configs/toolConfigs';
import { QuestionAnswerContent } from '@/modules/chat/tools/ContentRenderers/QuestionAnswerContent';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import type { Question } from '@/shared/types';

/**
 * The answered-question card shows the notes the user added to an answer
 * (Claude's `annotations[question].notes`, or OpenCode's split-out trailing
 * `notes:` entry), and a question answered with notes alone counts as
 * answered rather than skipped.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const pickOne: Question = { question: 'Pick one?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }] };
const pickTwo: Question = { question: 'Pick two?', header: 'Two', options: [{ label: 'C' }, { label: 'D' }] };

const renderCard = (props: {
  questions: Question[];
  answers: Record<string, string>;
  annotations?: Record<string, { notes?: unknown; preview?: unknown }>;
}) => render(React.createElement(QuestionAnswerContent, props));

test('card: shows the notes under the answer, collapsed and expanded', () => {
  const { container } = renderCard({
    questions: [pickOne],
    answers: { 'Pick one?': 'A' },
    annotations: { 'Pick one?': { notes: 'keep it small' } },
  });
  assert.match(container.textContent ?? '', /Notes/);
  assert.match(container.textContent ?? '', /keep it small/);

  fireEvent.click(screen.getByRole('button', { name: /Pick one\?/ }));
  assert.match(container.textContent ?? '', /keep it small/, 'still shown once expanded');
});

test('card: a question answered with notes alone is not shown as skipped', () => {
  const { container } = renderCard({
    questions: [pickOne],
    answers: {},
    annotations: { 'Pick one?': { notes: 'neither, see below' } },
  });

  assert.match(container.textContent ?? '', /neither, see below/);
  assert.doesNotMatch(container.textContent ?? '', /Skipped/);
});

test('card: among several questions, the notes-only one is neither skipped nor unanswered when expanded', () => {
  const { container } = renderCard({
    questions: [pickOne, pickTwo],
    answers: { 'Pick two?': 'C' },
    annotations: { 'Pick one?': { notes: 'later' } },
  });
  assert.doesNotMatch(container.textContent ?? '', /Skipped/);

  fireEvent.click(screen.getByRole('button', { name: /Pick one\?/ }));
  assert.doesNotMatch(container.textContent ?? '', /No answer provided/);
});

test('card: annotations without non-empty notes show no notes line', () => {
  const { container } = renderCard({
    questions: [pickOne, pickTwo],
    answers: { 'Pick one?': 'A', 'Pick two?': 'D' },
    annotations: { 'Pick one?': { preview: '<div>x</div>' }, 'Pick two?': { notes: '   ' } },
  });

  assert.doesNotMatch(container.textContent ?? '', /Notes/);
});

test('toolConfigs: the card gets annotations from the input, or from the stored tool result', () => {
  const config = getToolConfig('AskUserQuestion');
  const fromInput = config.input.getContentProps?.(
    { questions: [pickOne], annotations: { 'Pick one?': { notes: 'in input' } } },
    {},
  );
  assert.deepEqual(fromInput.annotations, { 'Pick one?': { notes: 'in input' } });

  const fromResult = config.input.getContentProps?.(
    { questions: [pickOne] },
    { toolResult: { toolUseResult: { answers: { 'Pick one?': 'A' }, annotations: { 'Pick one?': { notes: 'stored' } } } } },
  );
  assert.deepEqual(fromResult.annotations, { 'Pick one?': { notes: 'stored' } });
});

test('toolConfigs: the title counts a notes-only question as answered', () => {
  // ToolRenderer calls the title with the tool result as a second argument.
  const titleOf = getToolConfig('AskUserQuestion').input.title as (input: unknown, context?: unknown) => string;
  const title = titleOf(
    { questions: [pickOne, pickTwo] },
    { toolResult: { toolUseResult: { answers: {}, annotations: { 'Pick one?': { notes: 'later' } } } } },
  );

  assert.equal(title, '2 questions — 1 answered');
});

test('ToolRenderer: the notes reach the rendered card', () => {
  const { container } = render(
    <ToolRenderer
      toolName="AskUserQuestion"
      toolInput={JSON.stringify({ questions: [pickOne] })}
      toolResult={{
        content: 'answered',
        isError: false,
        toolUseResult: { answers: { 'Pick one?': 'A' }, annotations: { 'Pick one?': { notes: 'rendered note' } } },
      }}
      toolId="toolu_q"
      mode="input"
    />,
  );

  assert.match(container.textContent ?? '', /rendered note/);
});
