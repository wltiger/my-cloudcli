import type { ChildProcess } from 'node:child_process';

import type { AnyRecord } from '@/shared/types.js';

import { OPENCODE_SESSION_END_ANCHOR } from './opencode-anchors.js';
import {
  killOpenCodeProcessTree,
  startOpenCodeServeProcess,
} from './opencode-runtime.provider.js';

/**
 * Everything Fork and Edit need from OpenCode's HTTP server.
 *
 * These operations exist nowhere else: the one-shot `run` CLI has no fork and
 * no revert (verified in #18/#21), so each one has to start the same
 * short-lived headless `opencode serve` the Compact side channel already uses.
 * That server, and the Windows-safe kill that ends it, stay owned by
 * `opencode-runtime.provider.js` — this file only borrows them through
 * `withOpenCodeServe`, so there is exactly one implementation of each.
 *
 * Consumed by `opencode-sessions.provider.ts` (its `forkSession` and
 * `rewindSession` facets) and by `opencode-runtime.provider.js` itself, which
 * routes its Compact side channel through `withOpenCodeServe`.
 */

// Fork copies rows and runs no model, so it answers in well under a second;
// this only stops a wedged server from hanging the request that awaits it.
const OPENCODE_FORK_REQUEST_TIMEOUT_MS = 30_000;
// Revert restores a git snapshot as well as the conversation, so it does a
// little more work than fork does — still nowhere near a model call.
const OPENCODE_REVERT_REQUEST_TIMEOUT_MS = 30_000;

/** A running headless server, as `startOpenCodeServeProcess` hands it back. */
export type OpenCodeServeHandle = {
  process: ChildProcess;
  baseUrl: string;
};

/**
 * Runs one operation against a short-lived headless `opencode serve`.
 *
 * The single place the start/use/shut-down bracket is written. Every caller
 * needs the same guarantee — **the server is shut down before this returns, on
 * success, on failure and on throw alike** — and each hand-written copy of that
 * bracket was another chance to leak the ephemeral port instead.
 *
 * Exported for `opencode-runtime.provider.js`, whose Compact side channel is
 * the fourth caller.
 *
 * @param cwd Directory to start the server in. OpenCode's session storage is
 *   global (verified in #18/#21), so this does not restrict which sessions the
 *   operation can address; it only has to be a directory that exists.
 * @param run Receives the running server. Its result is this function's result.
 */
export async function withOpenCodeServe<T>(
  cwd: string | undefined,
  run: (serveHandle: OpenCodeServeHandle) => Promise<T>,
): Promise<T> {
  const serveHandle = await startOpenCodeServeProcess(cwd || process.cwd()) as OpenCodeServeHandle;

  try {
    return await run(serveHandle);
  } finally {
    await killOpenCodeProcessTree(serveHandle.process);
  }
}

/** Parses a response body as JSON, or undefined when it is not JSON at all. */
async function readOpenCodeJsonBody(response: Response): Promise<AnyRecord | undefined> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return undefined;
  }
}

/**
 * Forks an OpenCode session at an Anchor and returns the new session's id.
 *
 * Consumed by `opencode-sessions.provider.ts`, whose `forkSession` facet method
 * is this call and nothing else.
 *
 * OpenCode's fork is **exclusive**, so `anchor` already names the message
 * *after* the turn to keep (see `buildOpenCodeAnchorIndex`). The session-end
 * anchor has no message to name and is sent as no `messageID` at all, which
 * copies the session whole.
 */
export function forkOpenCodeSession(
  providerSessionId: string,
  { cwd, anchor, title }: { cwd: string; anchor: string; title: string },
): Promise<string> {
  return withOpenCodeServe(cwd, async (serveHandle) => {
    const response = await fetch(
      `${serveHandle.baseUrl}/session/${encodeURIComponent(providerSessionId)}/fork`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(anchor === OPENCODE_SESSION_END_ANCHOR ? {} : { messageID: anchor }),
        signal: AbortSignal.timeout(OPENCODE_FORK_REQUEST_TIMEOUT_MS),
      }
    );

    // Same trap Compact hit: the prefixed `/api/session/{id}/fork` is not a
    // route and falls through to the web UI's HTML catch-all, answering 200
    // with an HTML body. Only a session id read out of the body proves the
    // legacy unprefixed route actually forked anything.
    const forkedSessionId = (await readOpenCodeJsonBody(response))?.id;
    if (!response.ok || typeof forkedSessionId !== 'string' || !forkedSessionId) {
      throw new Error(`OpenCode fork failed (HTTP ${response.status}).`);
    }

    // The fork endpoint takes no title — OpenCode names the copy with a suffix
    // of its own — so the fork's name is a second call.
    const renameResponse = await fetch(
      `${serveHandle.baseUrl}/session/${encodeURIComponent(forkedSessionId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
        signal: AbortSignal.timeout(OPENCODE_FORK_REQUEST_TIMEOUT_MS),
      }
    );
    if ((await readOpenCodeJsonBody(renameResponse))?.title !== title) {
      // Not worth losing the fork over: CloudCLI shows its own name for it
      // regardless, and only OpenCode's own CLI would still read the suffix.
      console.warn(`[OpenCode] Forked session ${forkedSessionId} kept OpenCode's own title (HTTP ${renameResponse.status}).`);
    }

    return forkedSessionId;
  });
}

/**
 * Rewinds a session to `anchor`, rolling its tracked files back with it.
 *
 * Exported for `opencode-sessions.provider.ts`, whose `rewindSession` facet is
 * this same call: replacing an already-sent message rewinds the session here
 * first and then resumes it ordinarily, because OpenCode's runtime cannot
 * resume a transcript partway.
 */
export function revertOpenCodeSession(providerSessionId: string, cwd: string, anchor: string): Promise<void> {
  return withOpenCodeServe(cwd, async (serveHandle) => {
    const response = await fetch(
      `${serveHandle.baseUrl}/session/${encodeURIComponent(providerSessionId)}/revert`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageID: anchor }),
        signal: AbortSignal.timeout(OPENCODE_REVERT_REQUEST_TIMEOUT_MS),
      }
    );

    // The third time this trap has bitten the feature, and the most expensive:
    // the published `/api/session/{id}/revert` is not a route, falls through to
    // the web UI's HTML catch-all and answers 200 with an HTML body having
    // changed nothing at all (measured — the file it should have rolled back
    // was untouched). Only the recorded revert, read *out of the body* of the
    // legacy unprefixed route, proves anything ran.
    const session = await readOpenCodeJsonBody(response);
    if (!response.ok || session?.revert?.messageID !== anchor) {
      throw new Error(`OpenCode revert failed (HTTP ${response.status}).`);
    }
  });
}
