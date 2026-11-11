import assert from 'node:assert/strict';
import test from 'node:test';

import { splitQuestionNotes } from '@/modules/providers/list/opencode/opencode-question-notes.js';
import { OpenCodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';

/**
 * The chat panel sends OpenCode a question's notes as one trailing
 * `notes: …` entry in that question's label list. The question card shows it
 * as notes, not as a picked label. The live event and the history read share
 * the same rewrite (`toAskUserQuestionCall`), so the live path covers both.
 */

const questionState = (answers: string[][]) => ({
  status: 'completed',
  input: {
    questions: [
      { question: 'Which color?', header: 'Color', options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }] },
      { question: 'Which sizes?', header: 'Sizes', multiple: true, options: [{ label: 'Small', description: '' }] },
    ],
  },
  output: 'User has answered your questions.',
  title: 'Asked 2 questions',
  metadata: { answers },
  time: { start: 0, end: 1 },
});

const liveCardInput = (answers: string[][]) => {
  const [message] = new OpenCodeSessionsProvider().normalizeMessage({
    type: 'tool_use',
    sessionID: 'ses_1',
    part: { type: 'tool', tool: 'question', callID: 'call_q', state: questionState(answers) },
  }, 'app-session');
  assert.equal(message?.toolName, 'AskUserQuestion');
  return message?.toolInput as { answers?: unknown; annotations?: unknown } | undefined;
};

test('splitQuestionNotes takes only a trailing "notes: " entry', () => {
  assert.deepEqual(splitQuestionNotes(['Red', 'notes: a, b']), { labels: ['Red'], notes: 'a, b' });
  assert.deepEqual(splitQuestionNotes(['notes: only']), { labels: [], notes: 'only' });
  assert.deepEqual(splitQuestionNotes(['notes: first', 'Red']), { labels: ['notes: first', 'Red'], notes: '' });
  assert.deepEqual(splitQuestionNotes(['Red']), { labels: ['Red'], notes: '' });
  assert.deepEqual(splitQuestionNotes(['Red', 'notes:   ']), { labels: ['Red'], notes: '' });
});

test('OpenCode question card moves the trailing notes entry out of the answers', () => {
  const input = liveCardInput([['Red', 'notes: x, "y"'], ['Small']]);

  assert.deepEqual(input?.answers, { 'Which color?': 'Red', 'Which sizes?': 'Small' });
  assert.deepEqual(input?.annotations, { 'Which color?': { notes: 'x, "y"' } });
});

test('OpenCode question card keeps notes given without any answer', () => {
  const input = liveCardInput([['notes: just a note'], []]);

  assert.equal(input?.answers, undefined);
  assert.deepEqual(input?.annotations, { 'Which color?': { notes: 'just a note' } });
});

test('OpenCode question card leaves a non-trailing "notes: " label as an answer', () => {
  const input = liveCardInput([['notes: a', 'Red'], []]);

  assert.deepEqual(input?.answers, { 'Which color?': 'notes: a, Red' });
  assert.equal(input?.annotations, undefined);
});
