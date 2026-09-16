import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

/**
 * Session activity is two states, not one: a turn producing output, and work an
 * earlier turn left running. Only the first may keep a prompt out.
 *
 * These pin the shared half of that split — the set lives beside the processing
 * map in the same provider, and every consumer that asks "is this session busy?"
 * has to keep getting `false` for a session that is merely holding work. Fold
 * the two together and the composer starts queueing prompts and the transcript
 * stops refreshing while a subagent is still writing to it.
 */

vi.mock('@/shared/api', () => ({
  api: { runningSessions: () => Promise.resolve({ ok: false }) },
}));

const renderProtection = async () => {
  const {
    SessionProtectionProvider,
    useBackgroundWorkSessionIds,
    useSessionProtectionActions,
  } = await import('@/shared/context/SessionProtectionContext');

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(SessionProtectionProvider, null, children);

  return renderHook(
    () => ({
      backgroundWorkIds: useBackgroundWorkSessionIds(),
      actions: useSessionProtectionActions(),
    }),
    { wrapper },
  );
};

beforeEach(() => {
  vi.resetModules();
});

test('holding background work does not make a session read as processing', async () => {
  const { result } = await renderProtection();

  act(() => {
    result.current.actions.markSessionBackgroundWork('session-1', true);
  });

  assert.ok(result.current.backgroundWorkIds.has('session-1'));
  // `isSessionProcessing` is what gates the transcript reload a `session_upserted`
  // delta asks for, and the same map feeds the composer's queue gate. Both have
  // to stay blind to the hold.
  assert.equal(result.current.actions.isSessionProcessing('session-1'), false);
});

test('a processing session and a holding session are tracked separately', async () => {
  const { result } = await renderProtection();

  act(() => {
    result.current.actions.markSessionProcessing('answering');
    result.current.actions.markSessionBackgroundWork('holding', true);
  });

  assert.equal(result.current.actions.isSessionProcessing('answering'), true);
  assert.equal(result.current.actions.isSessionProcessing('holding'), false);
  assert.equal(result.current.backgroundWorkIds.has('answering'), false);
  assert.equal(result.current.backgroundWorkIds.has('holding'), true);
});

test('the background-work set keeps its identity when nothing changed', async () => {
  const { result } = await renderProtection();

  act(() => {
    result.current.actions.markSessionBackgroundWork('session-1', true);
  });
  const afterFirst = result.current.backgroundWorkIds;

  act(() => {
    // A run re-parks after every turn it holds through.
    result.current.actions.markSessionBackgroundWork('session-1', true);
  });
  assert.equal(result.current.backgroundWorkIds, afterFirst);

  act(() => {
    result.current.actions.markSessionBackgroundWork('session-1', false);
  });
  assert.equal(result.current.backgroundWorkIds.size, 0);
});
