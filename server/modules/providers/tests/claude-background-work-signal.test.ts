import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  claimHeldTurn,
  forgetHeldTurn,
  registerHeldTurn,
} from '@/modules/providers/list/claude/claude-turn-reuse.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

/**
 * The held-turn registry is the one place that knows whether a Claude session
 * still holds work that would die with its process, so it is also where the run
 * registry's background-work-outstanding state comes from.
 *
 * These pin the edges of that mirroring — especially the reuse path, where the
 * handle leaves the map at the *start* of a follow-up turn while the work it
 * represents carries on, so "did this call delete something" is not the same
 * question as "is anything still held".
 */

const HANDLE = { fingerprint: 'fp-1', tryAccept: async () => null };
const OTHER_HANDLE = { fingerprint: 'fp-1', tryAccept: async () => null };

afterEach(() => {
  chatRunRegistry.clearAll();
});

test('parking a run reports its background work as outstanding', () => {
  registerHeldTurn('app-1', HANDLE);
  assert.equal(chatRunRegistry.hasBackgroundWorkOutstanding('app-1'), true);
  // A turn is not in flight — that is the whole point of the split.
  assert.equal(chatRunRegistry.isProcessing('app-1'), false);

  forgetHeldTurn('app-1', HANDLE);
  assert.equal(chatRunRegistry.hasBackgroundWorkOutstanding('app-1'), false);
});

test('a follow-up turn claiming the process does not retire the hold', () => {
  registerHeldTurn('app-2', HANDLE);

  // The claim is the follow-up prompt being handed to the live process. The
  // background work is still running; only the ability to take *another*
  // follow-up is consumed.
  assert.equal(claimHeldTurn('app-2', 'fp-1'), HANDLE);
  assert.equal(chatRunRegistry.hasBackgroundWorkOutstanding('app-2'), true);
});

test('releasing a claimed process ends the hold even though the map is empty', () => {
  registerHeldTurn('app-3', HANDLE);
  claimHeldTurn('app-3', 'fp-1');

  // The follow-up turn ended with nothing outstanding, so the process is let go.
  // Its handle was already out of the map, so a delete-only signal would have
  // left the session showing a hold that no longer exists — with a Stop button
  // attached to nothing.
  forgetHeldTurn('app-3', HANDLE);
  assert.equal(chatRunRegistry.hasBackgroundWorkOutstanding('app-3'), false);
});

test('a superseded run winding down does not retire the newer run\'s hold', () => {
  registerHeldTurn('app-4', HANDLE);
  // A fresh process took the session over and parked in turn.
  registerHeldTurn('app-4', OTHER_HANDLE);

  forgetHeldTurn('app-4', HANDLE);
  assert.equal(chatRunRegistry.hasBackgroundWorkOutstanding('app-4'), true);

  forgetHeldTurn('app-4', OTHER_HANDLE);
  assert.equal(chatRunRegistry.hasBackgroundWorkOutstanding('app-4'), false);
});

test('an ordinary turn that never parked leaves the session clear', () => {
  forgetHeldTurn('app-5', HANDLE);
  assert.equal(chatRunRegistry.hasBackgroundWorkOutstanding('app-5'), false);
});
