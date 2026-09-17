import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import { AskUserQuestionPanel } from '@/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel';
import type { PendingPermissionRequest, Question } from '@/shared/types';

/**
 * The "Other" answer field is where users type free text the model did not
 * offer as an option — and where the long answers live. Its contract:
 *
 * - it is multi-line, so a long answer wraps and stays visible instead of
 *   scrolling horizontally behind a hint chip;
 * - Enter is a line break, never a submit — a line break mid-answer must not
 *   ship a half-finished panel;
 * - Ctrl/Cmd+Enter is the explicit advance/submit gesture;
 * - keys typed in the field are text, not panel shortcuts (no "0" toggling,
 *   no Escape skipping), while the container shortcuts keep working when the
 *   field is not the one being typed in.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const questionA: Question = {
  question: 'Which framework?',
  options: [{ label: 'React' }, { label: 'Vue' }],
};
const questionB: Question = {
  question: 'And the state library?',
  options: [{ label: 'Redux' }, { label: 'Zustand' }],
};

const makeRequest = (questions: Question[]): PendingPermissionRequest => ({
  requestId: 'req-1',
  toolName: 'AskUserQuestion',
  input: { questions },
});

const renderPanel = (questions: Question[]) => {
  const onDecision = vi.fn();
  const utils = render(
    React.createElement(AskUserQuestionPanel, {
      request: makeRequest(questions),
      onDecision,
    }),
  );
  const container = utils.container.querySelector('[tabindex="-1"]') as HTMLElement;
  return { ...utils, onDecision, container };
};

/** Activate the "Other" field with the same gesture a keyboard user makes. */
const activateOther = (container: HTMLElement) => {
  fireEvent.keyDown(container, { key: '0' });
};

const otherField = (container: HTMLElement) => {
  const field = container.querySelector('textarea');
  assert.ok(field, 'multi-line "Other" field rendered');
  return field as HTMLTextAreaElement;
};

test('Enter in the field is a line break — it neither advances nor submits', () => {
  const { container, onDecision } = renderPanel([questionA, questionB]);
  activateOther(container);
  const field = otherField(container);

  fireEvent.keyDown(field, { key: 'Enter' });

  // Still on the first question — the second's submit button has not appeared.
  assert.ok(screen.queryByRole('button', { name: /Next/ }), 'still on the first question');
  assert.equal(onDecision.mock.calls.length, 0);
});

test('Ctrl+Enter advances to the next question', () => {
  const { container } = renderPanel([questionA, questionB]);
  activateOther(container);
  const field = otherField(container);

  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });

  assert.ok(screen.queryByRole('button', { name: /Submit/ }), 'advanced to the last question');
});

test('Cmd+Enter advances too (macOS)', () => {
  const { container } = renderPanel([questionA, questionB]);
  activateOther(container);
  const field = otherField(container);

  fireEvent.keyDown(field, { key: 'Enter', metaKey: true });

  assert.ok(screen.queryByRole('button', { name: /Submit/ }), 'advanced to the last question');
});

test('Ctrl+Enter on the last question submits, with line breaks preserved in the answer', () => {
  const { container, onDecision } = renderPanel([questionA]);
  activateOther(container);
  const field = otherField(container);

  fireEvent.change(field, { target: { value: 'line one\nline two' } });
  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });

  assert.equal(onDecision.mock.calls.length, 1);
  const [requestId, decision] = onDecision.mock.calls[0] as [
    string,
    { allow?: boolean; updatedInput?: { answers?: Record<string, string> } },
  ];
  assert.equal(requestId, 'req-1');
  assert.equal(decision.allow, true);
  // The answer reaches the model exactly as typed — newlines included.
  assert.deepEqual(decision.updatedInput?.answers, { 'Which framework?': 'line one\nline two' });
});

test('keys typed in the field stay text — no "0" toggle, no digit select, no Escape skip', () => {
  const { container, onDecision } = renderPanel([questionA]);
  activateOther(container);
  const field = otherField(container);
  const submit = () => screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement;

  // A zero is part of the answer, not the shortcut that closes the field.
  fireEvent.keyDown(field, { key: '0' });
  assert.ok(container.querySelector('textarea'), 'the field is still active');

  // A digit typed in the field is text, not the shortcut that selects an option —
  // submitting stays disabled until something is actually chosen.
  fireEvent.keyDown(field, { key: '1' });
  assert.ok(submit().disabled, 'a "1" typed in the field selects nothing');

  // Escape while typing is not a skip.
  fireEvent.keyDown(field, { key: 'Escape' });
  assert.equal(onDecision.mock.calls.length, 0);
});

test('container shortcuts still work when the field is not in play', () => {
  const { container } = renderPanel([questionA]);
  const submit = () => screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement;

  assert.ok(submit().disabled, 'nothing selected yet');

  fireEvent.keyDown(container, { key: '1' });

  assert.equal(submit().disabled, false, 'number key selected an option');
});
