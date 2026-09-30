import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test } from 'vitest';

import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, DiffLine } from '@/shared/types';

/**
 * An Antigravity background notice carries two texts: a one-line summary
 * (`task-72 · exit code 1`) and the full body — for a finished command, its
 * output. The row used to show the summary alone, with no way to reach the
 * rest, and painted every outcome but `completed` the same amber.
 */

const notice = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'assistant',
  content: 'task-72 · exit code 1',
  timestamp: '2026-09-30T10:00:00.000Z',
  isTaskNotification: true,
  taskStatus: 'failed',
  taskBody: 'Task task-72 exited with code 1.\nError: build failed',
  ...overrides,
});

const createDiff = (): DiffLine[] => [];

const renderNotice = (message: ChatMessage) => render(
  <UiPreferencesProvider>
    <MessageComponent message={message} prevMessage={null} createDiff={createDiff} provider="antigravity" />
  </UiPreferencesProvider>,
);

test('a notice keeps its full body next to its one-line summary', () => {
  const [row] = normalizedToChatMessages([{
    id: 'notice-1',
    sessionId: 'session-1',
    timestamp: '2026-09-30T10:00:00.000Z',
    provider: 'antigravity',
    kind: 'task_notification',
    status: 'failed',
    summary: 'task-72 · exit code 1',
    content: 'Task task-72 exited with code 1.\nError: build failed',
  }]);

  assert.equal(row?.content, 'task-72 · exit code 1');
  assert.equal(row?.taskStatus, 'failed');
  assert.equal(row?.taskBody, 'Task task-72 exited with code 1.\nError: build failed');
});

test('a notice with a body expands to show it', () => {
  renderNotice(notice());

  assert.equal(screen.queryByText(/Error: build failed/), null, 'the body stays collapsed until asked for');
  fireEvent.click(screen.getByRole('button', { name: /task-72 · exit code 1/ }));
  assert.ok(screen.getByText(/Error: build failed/));
});

test('a notice whose summary is its whole body offers nothing to expand', () => {
  renderNotice(notice({ content: 'build finished', taskBody: 'build finished', taskStatus: 'completed' }));

  assert.equal(screen.queryByRole('button'), null);
});

test('the dot follows the outcome, and an unknown status keeps the old amber', () => {
  const colours: Array<[string, string]> = [
    ['completed', 'bg-green-400'],
    ['failed', 'bg-red-400'],
    ['cancelled', 'bg-gray-400'],
    ['info', 'bg-amber-400'],
  ];

  for (const [taskStatus, colour] of colours) {
    const { container, unmount } = renderNotice(notice({ taskStatus }));
    assert.ok(container.querySelector(`.${colour}`), `${taskStatus} should paint ${colour}`);
    unmount();
  }
});
