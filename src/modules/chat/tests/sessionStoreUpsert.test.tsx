import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { NormalizedMessage } from '@/shared/types';

/**
 * A tool step is sent when it starts and again when it finishes, under the same
 * id. The store appended both, so every call rendered as two cards and a long
 * session reached the realtime cap twice as fast.
 */

const row = (id: string, overrides: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  id,
  sessionId: 'session-1',
  timestamp: '2026-09-30T10:00:00.000Z',
  provider: 'antigravity',
  kind: 'text',
  role: 'assistant',
  content: id,
  ...overrides,
});

const toolStep = (overrides: Partial<NormalizedMessage> = {}) => row('tool-1', {
  kind: 'tool_use',
  toolId: 'tool-1',
  toolName: 'Bash',
  toolInput: { command: 'npm test' },
  ...overrides,
});

test('a row sent again under the same id replaces the first where it stands', () => {
  const { result } = renderHook(() => useSessionStore());

  act(() => {
    result.current.appendRealtime('session-1', toolStep());
    result.current.appendRealtime('session-1', row('text-1'));
    result.current.appendRealtime('session-1', toolStep({ toolResult: { content: 'ok', isError: false } }));
  });

  const messages = result.current.getMessages('session-1');
  assert.deepEqual(messages.map((message) => message.id), ['tool-1', 'text-1']);
  assert.equal(messages[0]?.toolResult?.content, 'ok');
});
