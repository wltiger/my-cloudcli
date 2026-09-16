import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

/**
 * When an already-sent message is replaced, every client watching the session
 * drops the superseded turns before the replacement streams in — otherwise the
 * transcript shows the question twice until the next REST refresh.
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

const row = (id: string, content: string, anchor?: string): NormalizedMessage => ({
  id,
  kind: 'text',
  role: anchor ? 'user' : 'assistant',
  provider: 'claude',
  sessionId: 'session-1',
  content,
  timestamp: `2026-01-01T00:00:0${id}.000Z`,
  ...(anchor ? { transcriptAnchorId: anchor } : {}),
} as NormalizedMessage);

const HISTORY = [
  row('1', 'first prompt', 'u1'),
  row('2', 'first answer'),
  row('3', 'second prompt', 'u2'),
  row('4', 'second answer'),
];

beforeEach(() => {
  sessionMessages.mockReset();
  sessionMessages.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { messages: HISTORY, total: HISTORY.length, hasMore: false } }),
  });
});

afterEach(() => {
  vi.resetModules();
});

async function loadedStore() {
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  const view = renderHook(() => useSessionStore());
  await act(async () => {
    await view.result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
  });
  return view;
}

describe('truncateAt', () => {
  it('drops the anchored message and everything after it', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.truncateAt('session-1', 'u2');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer'],
    );
  });

  it('keeps a message whose anchor was not the cut point', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.truncateAt('session-1', 'u1');
    });

    assert.deepEqual(result.current.getMessages('session-1'), []);
  });

  it('leaves the transcript alone for an anchor it does not hold', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.truncateAt('session-1', 'not-here');
    });

    assert.equal(result.current.getMessages('session-1').length, 4);
  });

  it('clears rows that streamed for the turn being replaced', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.appendRealtime('session-1', row('5', 'streaming reply'));
    });
    assert.equal(result.current.getMessages('session-1').length, 5);

    act(() => {
      result.current.truncateAt('session-1', 'u2');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer'],
    );
  });

  it('keeps the replacement the cut was made for', async () => {
    const { result } = await loadedStore();

    // The composer appends its echo of the edited message before the server
    // acknowledges the edit, so the cut arrives with the replacement already
    // on screen. Clearing it left the chat pane without the message the user
    // had just sent until the run finished.
    act(() => {
      result.current.appendRealtime('session-1', {
        ...row('5', 'second prompt, corrected'),
        role: 'user',
        replacesAnchorId: 'u2',
      } as NormalizedMessage);
    });

    act(() => {
      result.current.truncateAt('session-1', 'u2');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer', 'second prompt, corrected'],
    );
  });

  it('keeps the replacement last when the kept history comes back re-stamped', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.appendRealtime('session-1', {
        ...row('5', 'second prompt, corrected'),
        role: 'user',
        replacesAnchorId: 'u2',
      } as NormalizedMessage);
      result.current.truncateAt('session-1', 'u2');
    });

    // A provider that rewinds by branching writes the surviving turns into a
    // fresh transcript, so the next refresh returns them stamped later than
    // the replacement was typed. Without a floor on where a replacement can
    // sort, the message the user just sent moves to the top.
    sessionMessages.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          messages: [
            { ...row('1', 'first prompt', 'u1'), timestamp: '2026-01-01T00:00:09.000Z' },
            { ...row('2', 'first answer'), timestamp: '2026-01-01T00:00:09.001Z' },
          ],
          total: 2,
          hasMore: false,
        },
      }),
    });

    await act(async () => {
      await result.current.refreshLatestFromServer('session-1');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer', 'second prompt, corrected'],
    );
  });

  it('keeps only the newest replacement when an earlier attempt was refused', async () => {
    const { result } = await loadedStore();

    // A refused send leaves its echo in place — nothing rolls it back — so by
    // the time an edit succeeds the store can be holding two attempts at the
    // same message.
    act(() => {
      result.current.appendRealtime('session-1', {
        ...row('5', 'first attempt'),
        role: 'user',
        replacesAnchorId: 'u2',
      } as NormalizedMessage);
      result.current.appendRealtime('session-1', {
        ...row('6', 'second attempt'),
        role: 'user',
        replacesAnchorId: 'u2',
      } as NormalizedMessage);
      result.current.truncateAt('session-1', 'u2');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer', 'second attempt'],
    );
  });

  it('clears a replacement tagged for a different cut', async () => {
    const { result } = await loadedStore();

    act(() => {
      result.current.appendRealtime('session-1', {
        ...row('5', 'first prompt, corrected'),
        role: 'user',
        replacesAnchorId: 'u1',
      } as NormalizedMessage);
    });

    act(() => {
      result.current.truncateAt('session-1', 'u2');
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => message.content),
      ['first prompt', 'first answer'],
    );
  });
});

describe('an edit that rewinds the branch', () => {
  // The provider abandons the old branch and grows a new one from the same
  // prefix. The row the cut left at the bottom of the cache (a task
  // notification) no longer exists at that position in the transcript — the
  // new branch re-injects a different one — so no fetched window can ever
  // bridge onto the cached suffix. The next tail refresh has to replace the
  // cache outright, and the edit's echo must retire against the persisted
  // replacement row instead of staying floored at the bottom of the view.
  const BASE = Date.parse('2026-09-14T09:30:00.000Z');
  const at = (ms: number) => new Date(BASE + ms).toISOString();

  const oldRow = (index: number, overrides: Partial<NormalizedMessage> = {}) => ({
    id: `old-${index}`,
    kind: 'text',
    role: 'assistant',
    provider: 'claude',
    sessionId: 'session-1',
    content: `old turn ${index}`,
    timestamp: at(index * 1000),
    ...overrides,
  }) as NormalizedMessage;

  const REPLACEMENT_TEXT = '请使用 /playwright-cli --headed来打开，我可以同步看到窗口';

  const oldBranchPage = (): NormalizedMessage[] => [
    ...Array.from({ length: 20 }, (_, i) => oldRow(71 + i)),
    oldRow(90, { role: 'user', content: '看到了', transcriptAnchorId: 'anchor-a' }),
  ];

  const newBranchPage = (): NormalizedMessage[] => [
    ...Array.from({ length: 8 }, (_, i) => oldRow(81 + i)),
    // The new branch's row at the position the old branch's task notification
    // held: different id, different content, later timestamp.
    oldRow(89, {
      id: 'new-89',
      content: '<task-notification>re-injected</task-notification>',
      timestamp: at(1_069_525),
    }),
    oldRow(90, {
      id: 'new-90',
      role: 'user',
      content: REPLACEMENT_TEXT,
      timestamp: at(1_069_553),
    }),
    ...Array.from({ length: 10 }, (_, i) => oldRow(91 + i, { timestamp: at(1_075_000 + i * 1000) })),
  ];

  it('replaces the cache the cut froze and retires the edit echo', async () => {
    const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
    const { result } = renderHook(() => useSessionStore());

    await act(async () => {
      sessionMessages
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { messages: oldBranchPage(), total: 91, hasMore: true } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { messages: newBranchPage(), total: 101, hasMore: true } }),
        });
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    const echo = oldRow(90, {
      id: 'local_echo',
      role: 'user',
      content: REPLACEMENT_TEXT,
      timestamp: at(1_065_000),
      replacesAnchorId: 'anchor-a',
    });
    act(() => {
      result.current.appendRealtime('session-1', echo);
    });

    act(() => {
      result.current.truncateAt('session-1', 'anchor-a');
    });

    await act(async () => {
      await result.current.refreshLatestFromServer('session-1');
    });

    const messages = result.current.getMessages('session-1');
    assert.ok(
      !messages.some((message) => message.id === 'local_echo'),
      'the edit echo must be retired once its persisted row is cached',
    );
    assert.ok(
      messages.some((message) => message.content === REPLACEMENT_TEXT),
      'the persisted replacement row is shown',
    );
    assert.equal(
      messages[messages.length - 1].id,
      'old-100',
      'the newest server row stays at the bottom, not the echo',
    );
  });
});
