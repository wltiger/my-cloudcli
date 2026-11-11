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

test('the field keeps focus and its answer when fullscreen is toggled either way', () => {
  const { container } = renderPanel([questionA]);
  activateOther(container);
  fireEvent.change(otherField(container), { target: { value: 'line one\nline two' } });

  fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
  const inFullscreen = document.body.querySelector('textarea') as HTMLTextAreaElement;
  assert.equal(document.activeElement, inFullscreen, 'focused after entering fullscreen');
  assert.equal(inFullscreen.value, 'line one\nline two');

  fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
  const inline = document.body.querySelector('textarea') as HTMLTextAreaElement;
  assert.equal(document.activeElement, inline, 'focused after leaving fullscreen');
  assert.equal(inline.value, 'line one\nline two');
});

/**
 * Notes ride along with a picked option instead of replacing it. Claude takes
 * them as `annotations[question].notes`, the field its CLI already forwards to
 * the model; OpenCode has no such field, so they become a trailing
 * `notes: …` entry in that question's label list.
 */

type Decision = {
  allow?: boolean;
  updatedInput?: { answers?: unknown; annotations?: unknown };
};

const lastDecision = (onDecision: ReturnType<typeof vi.fn>) => {
  assert.equal(onDecision.mock.calls.length, 1, 'submitted exactly once');
  return (onDecision.mock.calls[0] as [string, Decision])[1];
};

const notesField = () => screen.queryByRole('textbox', { name: /notes/i }) as HTMLTextAreaElement | null;

/** Open the notes field with the keyboard and type into it. */
const writeNotes = (container: HTMLElement, text: string) => {
  fireEvent.keyDown(container, { key: 'n' });
  const field = notesField();
  assert.ok(field, 'notes field opened');
  fireEvent.change(field, { target: { value: text } });
  return field;
};

const renderLabelListPanel = (questions: Question[]) => {
  const onDecision = vi.fn();
  const utils = render(
    React.createElement(AskUserQuestionPanel, {
      request: { ...makeRequest(questions), context: { answerFormat: 'label-lists' } },
      onDecision,
    }),
  );
  const container = utils.container.querySelector('[tabindex="-1"]') as HTMLElement;
  return { ...utils, onDecision, container };
};

test('notes: an option plus notes sends both — the option as the answer, the notes as annotations', () => {
  const { container, onDecision } = renderPanel([questionA]);
  fireEvent.keyDown(container, { key: '1' });
  const field = writeNotes(container, '  x, "y"  ');

  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });

  const decision = lastDecision(onDecision);
  assert.deepEqual(decision.updatedInput?.answers, { 'Which framework?': 'React' });
  assert.deepEqual(decision.updatedInput?.annotations, { 'Which framework?': { notes: 'x, "y"' } });
});

test('notes: without notes the decision carries no annotations key at all', () => {
  const { container, onDecision } = renderPanel([questionA]);
  fireEvent.keyDown(container, { key: '1' });
  fireEvent.keyDown(container, { key: 'n' });

  fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

  const decision = lastDecision(onDecision);
  assert.ok(decision.updatedInput && !('annotations' in decision.updatedInput), 'no annotations key');
});

test('notes: notes alone on an earlier question are enough to submit', () => {
  const { container, onDecision } = renderPanel([questionA, questionB]);
  writeNotes(container, 'only a note');
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));

  const submit = screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement;
  assert.equal(submit.disabled, false, 'a note on Q1 makes the panel submittable');
  fireEvent.click(submit);

  const decision = lastDecision(onDecision);
  assert.deepEqual(decision.updatedInput?.answers, {});
  assert.deepEqual(decision.updatedInput?.annotations, { 'Which framework?': { notes: 'only a note' } });
});

test('notes: "n" opens the field and focuses it; clicking the entry does the same', () => {
  const { container } = renderPanel([questionA]);
  assert.equal(notesField(), null, 'closed until asked for');

  fireEvent.keyDown(container, { key: 'n' });
  assert.equal(document.activeElement, notesField(), 'focused after "n"');
});

test('notes: the entry can be opened with a click', () => {
  renderPanel([questionA]);
  fireEvent.click(screen.getByRole('button', { name: /Add notes/ }));
  assert.ok(notesField(), 'opened by click');
});

test('notes: an "n" typed in the Other field is text, not the notes shortcut', () => {
  const { container } = renderPanel([questionA]);
  activateOther(container);

  fireEvent.keyDown(otherField(container), { key: 'n' });

  assert.equal(notesField(), null);
});

test('notes: keys typed in the notes field stay text — no digit select, no Escape skip', () => {
  const { container, onDecision } = renderPanel([questionA]);
  const field = writeNotes(container, 'abc');

  fireEvent.keyDown(field, { key: '1' });
  fireEvent.keyDown(field, { key: 'Escape' });
  assert.equal(onDecision.mock.calls.length, 0, 'Escape in the field is not a skip');

  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
  const decision = lastDecision(onDecision);
  assert.deepEqual(decision.updatedInput?.answers, {}, 'the "1" selected nothing');
  assert.deepEqual(decision.updatedInput?.annotations, { 'Which framework?': { notes: 'abc' } });
});

test('notes: OpenCode gets the notes as a trailing "notes: …" label', () => {
  const { container, onDecision } = renderLabelListPanel([questionA]);
  fireEvent.keyDown(container, { key: '1' });
  const field = writeNotes(container, 'x');

  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });

  assert.deepEqual(lastDecision(onDecision).updatedInput?.answers, [['React', 'notes: x']]);
});

test('notes: an options-only question still offers notes, and OpenCode still receives them', () => {
  const optionsOnly: Question = { ...questionA, custom: false };
  const { container, onDecision } = renderLabelListPanel([optionsOnly]);

  assert.equal(screen.queryByRole('button', { name: /Other/ }), null, 'no Other for options-only');
  assert.ok(screen.getByRole('button', { name: /Add notes/ }), 'notes entry still offered');

  fireEvent.keyDown(container, { key: '2' });
  const field = writeNotes(container, 'why');
  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });

  assert.deepEqual(lastDecision(onDecision).updatedInput?.answers, [['Vue', 'notes: why']]);
});

test('notes: the field keeps focus and its text when fullscreen is toggled', () => {
  const { container } = renderPanel([questionA]);
  writeNotes(container, 'half a thought');

  fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
  assert.equal(document.activeElement, notesField(), 'focused after entering fullscreen');
  assert.equal(notesField()?.value, 'half a thought');
  assert.equal(notesField()?.selectionStart, 'half a thought'.length, 'caret after the text, not before it');

  fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
  assert.equal(document.activeElement, notesField(), 'focused after leaving fullscreen');
  assert.equal(notesField()?.value, 'half a thought');
});

test('notes: with "Other" open too, fullscreen hands focus back to the field typed in last', () => {
  const { container } = renderPanel([questionA]);
  activateOther(container);
  fireEvent.change(otherField(container), { target: { value: 'my own answer' } });
  writeNotes(container, 'typed last');

  fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
  assert.equal(document.activeElement, notesField(), 'notes were typed last');

  fireEvent.change(otherField(document.body), { target: { value: 'my own answer, edited' } });
  fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
  assert.equal(document.activeElement, otherField(document.body), '"Other" was typed last');
});

test('notes: clicking an option while the field is open does not pull focus into the field', () => {
  const { container } = renderPanel([questionA]);
  writeNotes(container, 'a note');

  const vue = screen.getByRole('button', { name: /Vue/ });
  vue.focus();
  fireEvent.click(vue);

  assert.notEqual(document.activeElement, notesField(), 'focus stays out of the notes field');
});

test('notes: with the field open the advance hint is Ctrl+Enter', () => {
  const { container } = renderPanel([questionA, questionB]);
  assert.match(screen.getByRole('button', { name: /Next/ }).textContent ?? '', /Enter/);

  fireEvent.keyDown(container, { key: 'n' });

  assert.match(screen.getByRole('button', { name: /Next/ }).textContent ?? '', /Ctrl\+Enter/);
});

test('notes: a question keeps its notes open and filled when the user comes back to it', () => {
  const { container } = renderPanel([questionA, questionB]);
  writeNotes(container, 'remember me');

  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  assert.equal(notesField(), null, 'the next question starts closed');

  fireEvent.click(screen.getByRole('button', { name: /Back/ }));
  assert.equal(notesField()?.value, 'remember me');
});
