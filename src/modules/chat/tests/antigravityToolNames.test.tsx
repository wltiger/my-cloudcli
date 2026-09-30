import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { test } from 'vitest';

import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import { formatToolDisplayName, TOOL_CONFIGS } from '@/modules/chat/tools/configs/toolConfigs';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { DiffLine, NormalizedMessage } from '@/shared/types';

/**
 * The tools only Antigravity has are keyed `Agy*` so they cannot collide with a
 * Claude tool, and wherever no label covered a header — a result block, the
 * document card's head — that key is what showed. Each gets the name its row
 * already shows.
 *
 * The name is display only. `Task` is also what the backend calls a subagent
 * container, and SubagentPanel routing must keep reading the provider's tool
 * name: a task check headed `Task` is still not an agent.
 */

const HEADERS: Record<string, string> = {
  AgyTask: 'Task',
  AgySchedule: 'Schedule',
  AgySubagents: 'Subagents',
  AgyMessage: 'Message',
  AgyImage: 'Image',
  AgyArtifactDoc: 'Document',
};

const toolRow = (toolName: string, toolInput: Record<string, unknown>): NormalizedMessage => ({
  id: `tool-${toolName}`,
  sessionId: 'session-1',
  timestamp: '2026-09-30T10:00:00.000Z',
  provider: 'antigravity',
  kind: 'tool_use',
  toolId: `tool-${toolName}`,
  toolName,
  toolInput,
  toolResult: { content: 'The command exited with code 0.', isError: false },
} as NormalizedMessage);

const createDiff = (): DiffLine[] => [];

test('each Antigravity tool is headed by the name its row already shows', () => {
  for (const [toolName, header] of Object.entries(HEADERS)) {
    assert.equal(formatToolDisplayName(toolName), header, toolName);

    // One-line rows show their label; the document card falls back to its title.
    const input = TOOL_CONFIGS[toolName].input;
    const shown = input.label ?? (typeof input.title === 'function' ? input.title({}) : input.title);
    assert.equal(shown, header, `${toolName}'s row`);
  }
});

test('a task check headed Task is not routed to the subagent panel, while a real container still is', () => {
  const [taskCheck, container] = normalizedToChatMessages([
    toolRow('AgyTask', { taskName: 'task-58', action: 'status' }),
    toolRow('Task', { subagent_type: 'browser', description: 'Check the page', prompt: 'Open it' }),
  ]);

  assert.equal(taskCheck?.isSubagentContainer, false);
  assert.equal(container?.isSubagentContainer, true);
});

test('a task check reads Task on its row and on its result block', () => {
  const [row] = normalizedToChatMessages([toolRow('AgyTask', { taskName: 'task-58', action: 'status' })]);

  render(
    <UiPreferencesProvider>
      <MessageComponent message={row!} prevMessage={null} createDiff={createDiff} provider="antigravity" />
    </UiPreferencesProvider>,
  );

  assert.equal(screen.queryByText('AgyTask'), null);
  assert.equal(screen.getAllByText('Task').length, 2);
  assert.ok(screen.getByText('Output'), 'the result block is there, under its own title');
});
