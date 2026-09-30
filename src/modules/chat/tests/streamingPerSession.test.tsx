import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { ProjectSession, ServerEvent } from '@/shared/types';

/**
 * Streamed text is buffered and flushed into the store every 100ms. The buffer
 * and its timer used to be shared by every session, so two sessions streaming
 * at once interfered: the second found the timer already set and never flushed
 * its own text, and a session in the background got its deltas appended as
 * raw rows, one per chunk.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const streamed: Array<[string, string]> = [];
  const finalized: string[] = [];
  const appended: string[] = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'antigravity',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: new Map() },
    accumulatedStreamRef: { current: new Map() },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore: {
      updateStreaming: (sessionId: string, text: string) => { streamed.push([sessionId, text]); },
      finalizeStreaming: (sessionId: string) => { finalized.push(sessionId); },
      appendRealtime: (sessionId: string) => { appended.push(sessionId); },
    } as unknown as SessionStore,
  }));

  const dispatch = (event: Record<string, unknown>) => listener?.(event as unknown as ServerEvent);
  return {
    delta: (sessionId: string, content: string) => dispatch({ kind: 'stream_delta', sessionId, content }),
    end: (sessionId: string) => dispatch({ kind: 'stream_end', sessionId }),
    streamed,
    finalized,
    appended,
  };
};

test('two sessions streaming at once each flush their own text', () => {
  const { delta, streamed } = renderHandlers();

  delta('viewed-session', 'Hello ');
  delta('background-session', 'Other ');
  delta('viewed-session', 'world');
  delta('background-session', 'text');
  vi.advanceTimersByTime(100);

  assert.deepEqual(streamed, [
    ['viewed-session', 'Hello world'],
    ['background-session', 'Other text'],
  ]);
});

test('a background session streams into its streaming row, not one raw row per chunk', () => {
  const { delta, streamed, appended } = renderHandlers();

  delta('background-session', 'chunk one, ');
  delta('background-session', 'chunk two');
  vi.advanceTimersByTime(100);

  assert.deepEqual(appended, []);
  assert.deepEqual(streamed, [['background-session', 'chunk one, chunk two']]);
});

test('ending one session\'s stream leaves the other session\'s buffer alone', () => {
  const { delta, end, streamed, finalized } = renderHandlers();

  delta('viewed-session', 'still ');
  delta('background-session', 'done');
  end('background-session');
  delta('viewed-session', 'going');
  vi.advanceTimersByTime(100);

  assert.deepEqual(finalized, ['background-session']);
  assert.deepEqual(streamed, [
    ['background-session', 'done'],
    ['viewed-session', 'still going'],
  ]);
});
