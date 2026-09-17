import assert from 'node:assert/strict';

import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { ProjectSession, ServerEvent } from '@/shared/types';

/**
 * "A turn is producing output" and "this session still holds background work"
 * are two states, and only the first may stand in a prompt's way.
 *
 * Collapsing them is the failure this file guards: fold background work into the
 * processing map and the composer starts queueing prompts, the transcript stops
 * refreshing while a subagent is writing to it, and the next prompt — the thing
 * that actually keeps the work alive — never goes.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const backgroundWork: Array<[string | null | undefined, boolean]> = [];
  const processing: string[] = [];
  const idle: string[] = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    onSessionProcessing: (sessionId) => { processing.push(String(sessionId)); },
    onSessionIdle: (sessionId) => { idle.push(String(sessionId)); },
    onSessionBackgroundWork: (sessionId, outstanding) => {
      backgroundWork.push([sessionId, outstanding]);
    },
    requestLatestMessages: async () => {},
    sessionStore: { appendRealtime: () => {} } as unknown as SessionStore,
  }));

  return {
    dispatch: (event: ServerEvent) => listener?.(event),
    backgroundWork,
    processing,
    idle,
  };
};

test('a background-work delta never touches the processing state', () => {
  const { dispatch, backgroundWork, processing, idle } = renderHandlers();

  dispatch({
    kind: 'session_background_work',
    sessionId: 'viewed-session',
    outstanding: true,
  } as unknown as ServerEvent);

  assert.deepEqual(backgroundWork, [['viewed-session', true]]);
  // Marking the session as processing here is what would queue the user's next
  // prompt and freeze the transcript the background work is still writing to.
  assert.deepEqual(processing, []);
  assert.deepEqual(idle, []);
});

test('a session can be idle and still reported as holding background work', () => {
  const { dispatch, backgroundWork, idle } = renderHandlers();

  // The ack a client gets after a reload — the only place a hold whose delta it
  // missed can be recovered from.
  dispatch({
    kind: 'chat_subscribed',
    sessionId: 'viewed-session',
    isProcessing: false,
    backgroundWorkOutstanding: true,
    pendingPermissions: [],
  } as unknown as ServerEvent);

  assert.deepEqual(backgroundWork, [['viewed-session', true]]);
  assert.deepEqual(idle, ['viewed-session']);
});

test('an ack without background work reports the hold as finished', () => {
  const { dispatch, backgroundWork } = renderHandlers();

  dispatch({
    kind: 'chat_subscribed',
    sessionId: 'viewed-session',
    isProcessing: true,
    pendingPermissions: [],
  } as unknown as ServerEvent);

  assert.deepEqual(backgroundWork, [['viewed-session', false]]);
});

const renderIndicator = async (props: Record<string, unknown>) => {
  const { default: ActivityIndicator } = await import('@/modules/chat/composer/ActivityIndicator');
  return render(React.createElement(ActivityIndicator, props as never));
};

test('Stop stays available while only background work is outstanding', async () => {
  const onAbort = vi.fn();
  await renderIndicator({ activity: null, backgroundWorkOutstanding: true, onAbort });

  // Before the split this row was simply absent: the turn had reported complete,
  // so there was no UI-level way to abort a task that could still run for half
  // an hour.
  assert.ok(screen.getByText('Background work still running'));

  const stop = screen.getByRole('button', { name: 'Stop background work' });
  // The copy has to say what stopping now costs — it ends the work, not just a
  // reply that already finished.
  assert.match(stop.getAttribute('title') ?? '', /ends the background work/);

  fireEvent.click(stop);
  assert.equal(onAbort.mock.calls.length, 1);
});

test('stopping mid-turn warns that background work goes with it', async () => {
  await renderIndicator({
    activity: { statusText: 'Thinking', canInterrupt: true, startedAt: Date.now() },
    backgroundWorkOutstanding: true,
    onAbort: () => {},
  });

  const stop = screen.getByRole('button', { name: 'Stop' });
  assert.match(stop.getAttribute('title') ?? '', /ends the background work/);
});

test('a session with neither state renders no indicator at all', async () => {
  const { container } = await renderIndicator({
    activity: null,
    backgroundWorkOutstanding: false,
    onAbort: () => {},
  });

  assert.equal(container.innerHTML, '');
});

test('faded while the reader has scrolled up, but Stop stays clickable', async () => {
  const onAbort = vi.fn();
  const { container } = await renderIndicator({
    activity: null,
    backgroundWorkOutstanding: true,
    onAbort,
    isFaded: true,
  });

  // Faded, not hidden: the work is still alive, so the tab stays visible —
  // just out of the reader's way while they read history. The fade must sit
  // on the inner row (the transition-opacity element), not the wrapper: the
  // wrapper's enter/exit animations use `animation … both`, which pins the
  // wrapper's own opacity and would swallow a fade applied there.
  const fadedRow = [...container.querySelectorAll<HTMLElement>('[class*="transition-opacity"]')]
    .find((el) => el.className.includes('opacity-40'));
  assert.ok(fadedRow, 'fade applied to the inner row, not the animated wrapper');

  const stop = screen.getByRole('button', { name: 'Stop background work' });
  fireEvent.click(stop);
  assert.equal(onAbort.mock.calls.length, 1);
});

test('fully opaque at the bottom', async () => {
  const { container } = await renderIndicator({
    activity: null,
    backgroundWorkOutstanding: true,
    onAbort: () => {},
    isFaded: false,
  });

  const row = container.querySelector<HTMLElement>('[class*="transition-opacity"]');
  assert.ok(row, 'inner row rendered');
  assert.ok(row.className.includes('opacity-100'), 'inner row fully opaque');
  assert.equal(container.querySelector('[class*="opacity-40"]'), null);
});
