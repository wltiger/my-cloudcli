import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { isActivityIndicatorVisible } from '@/modules/chat/composer/indicatorVisibility';

/**
 * "Is the status tab above the composer visible" is one question with two
 * consumers: the composer renders the tab, and the transcript must reserve
 * bottom space for it. The two checks used to be hand-mirrored, and the
 * mirror went stale — the tab showed while only background work was
 * outstanding, but the transcript kept its small padding, so the tab covered
 * the last message. One shared definition is what keeps them agreed.
 *
 * Turn-in-flight and background-work-outstanding are separate signals (ADR
 * 0012); this predicate is a visibility consumer of both, and gates nothing —
 * send admission and queue gating keep reading turn-in-flight alone.
 */

test('visible while a turn is in flight, no background work', () => {
  assert.equal(
    isActivityIndicatorVisible({
      turnInFlight: true,
      backgroundWorkOutstanding: false,
      hasPendingPermissions: false,
    }),
    true,
  );
});

test('visible while only background work is outstanding — the regression', () => {
  assert.equal(
    isActivityIndicatorVisible({
      turnInFlight: false,
      backgroundWorkOutstanding: true,
      hasPendingPermissions: false,
    }),
    true,
  );
});

test('visible when both states hold', () => {
  assert.equal(
    isActivityIndicatorVisible({
      turnInFlight: true,
      backgroundWorkOutstanding: true,
      hasPendingPermissions: false,
    }),
    true,
  );
});

test('invisible when the session is idle and holds no work', () => {
  assert.equal(
    isActivityIndicatorVisible({
      turnInFlight: false,
      backgroundWorkOutstanding: false,
      hasPendingPermissions: false,
    }),
    false,
  );
});

test('a pending permission request suppresses the tab in every state', () => {
  for (const turnInFlight of [true, false]) {
    for (const backgroundWorkOutstanding of [true, false]) {
      assert.equal(
        isActivityIndicatorVisible({
          turnInFlight,
          backgroundWorkOutstanding,
          hasPendingPermissions: true,
        }),
        false,
      );
    }
  }
});

// The truth table above is also satisfied by the two *separate* hand-mirrored
// checks that preceded this predicate — so it cannot catch the regression that
// actually happened: a call site silently reverting to a local re-derivation
// (the transcript's copy dropped `backgroundWorkOutstanding`). An upstream
// merge is the likeliest way that happens, and the sync note in
// fork-customizations.md is only as good as the test that enforces it. Reading
// the two consumer files' sources is the only assertion that pins "both call
// sites keep calling the shared definition" rather than "the definition is
// correct."
test('both visibility consumers call the shared predicate, not a local copy', () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  const chatInterface = read('../ChatInterface.tsx');
  const chatComposer = read('../composer/ChatComposer.tsx');

  for (const [name, source] of [
    ['ChatInterface.tsx', chatInterface],
    ['ChatComposer.tsx', chatComposer],
  ] as const) {
    assert.match(
      source,
      /isActivityIndicatorVisible\(\s*\{/,
      `${name} must derive visibility from the shared predicate`,
    );
    // The background-work arm is the one that drifted away last; if a local
    // copy ever replaces the call, it must still feed background work in.
    // (Matches the `backgroundWorkOutstanding:` and shorthand `backgroundWorkOutstanding,` forms.)
    assert.match(
      source,
      /backgroundWorkOutstanding\s*[:,]/,
      `${name} must keep feeding backgroundWorkOutstanding into the predicate`,
    );
  }
});
