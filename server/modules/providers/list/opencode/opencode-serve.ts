import type { ChildProcess } from 'node:child_process';

import type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

import { OPENCODE_SESSION_END_ANCHOR } from './opencode-anchors.js';
import {
  killOpenCodeProcessTree,
  spawnOpenCode,
  startOpenCodeServeProcess,
} from './opencode-runtime.provider.js';

/**
 * Everything Fork and Rewind need from OpenCode's HTTP server.
 *
 * These operations exist nowhere else: the one-shot `run` CLI has no fork, no
 * revert and no unrevert (verified in #18/#21), so each one has to start the
 * same short-lived headless `opencode serve` the Compact side channel already
 * uses. That server, and the Windows-safe kill that ends it, stay owned by
 * `opencode-runtime.provider.js` — this file only borrows them through
 * `withOpenCodeServe`, so there is exactly one implementation of each.
 *
 * Consumed by `opencode-sessions.provider.ts` (its `forkSession` facet) and by
 * `opencode-runtime.provider.js` itself, which routes its Compact side channel
 * through `withOpenCodeServe` and hands a Rewind send to
 * `runOpenCodeRewindSend`.
 */

// Fork copies rows and runs no model, so it answers in well under a second;
// this only stops a wedged server from hanging the request that awaits it.
const OPENCODE_FORK_REQUEST_TIMEOUT_MS = 30_000;
// Revert and unrevert restore a git snapshot as well as the conversation, so
// they do a little more work than fork does — still nowhere near a model call.
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
 * The revert and the unrevert below each get their own server, because the
 * revert happens at send time and the unrevert only if that send later fails,
 * with the whole run in between.
 */
function revertOpenCodeSession(providerSessionId: string, cwd: string, anchor: string): Promise<void> {
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

/**
 * Puts a Rewind back after the send that carried it failed.
 *
 * Deliberately not a bare `unrevert`, because of one measured fact:
 * `opencode run` **commits** an outstanding revert the moment it appends its
 * own user message, deleting every reverted message for good — which happens
 * before the model call that most failures come from. By then there is nothing
 * left to undo, and `unrevert` still answers 200 with an empty `revert`, which
 * is indistinguishable from having restored something. So the session is read
 * first and only a revert still standing at this Anchor is undone; the caller
 * needs the difference because it has to tell the reader the truth about their
 * working tree.
 *
 * @returns true when the conversation and the files were actually put back.
 */
function undoOpenCodeRewind(providerSessionId: string, cwd: string, anchor: string): Promise<boolean> {
  return withOpenCodeServe(cwd, async (serveHandle) => {
    const sessionUrl = `${serveHandle.baseUrl}/session/${encodeURIComponent(providerSessionId)}`;

    const sessionResponse = await fetch(sessionUrl, {
      signal: AbortSignal.timeout(OPENCODE_REVERT_REQUEST_TIMEOUT_MS),
    });
    const current = await readOpenCodeJsonBody(sessionResponse);

    // A read that failed is not evidence that anything was committed. Falling
    // through to the `false` below would tell the reader their earlier messages
    // are gone for good and their files are still rolled back, on the strength
    // of a 500 — the very lie the session is read here to avoid. An unreadable
    // session throws instead, so the caller reports the state as unknown rather
    // than as settled.
    if (!sessionResponse.ok || typeof current?.id !== 'string') {
      throw new Error(`OpenCode session could not be read (HTTP ${sessionResponse.status}).`);
    }

    if (current.revert?.messageID !== anchor) {
      return false;
    }

    const response = await fetch(`${sessionUrl}/unrevert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(OPENCODE_REVERT_REQUEST_TIMEOUT_MS),
    });
    const session = await readOpenCodeJsonBody(response);
    if (!response.ok || typeof session?.id !== 'string' || session.revert) {
      throw new Error(`OpenCode unrevert failed (HTTP ${response.status}).`);
    }

    return true;
  });
}

/**
 * The Anchor a pending Rewind put on this send, or null when there is none.
 *
 * The frontend snapshots it into the send options under the name Claude's SDK
 * option uses, so it arrives here for free — `chat-websocket.service.ts`
 * spreads unknown client options straight through. It is meaningless without a
 * session to revert.
 *
 * Exported for `opencode-runtime.provider.js`, which dispatches a send on it.
 */
export function readOpenCodeRewindAnchor(options: AnyRecord | undefined): string | null {
  const anchor = options?.resumeSessionAt;
  return typeof anchor === 'string' && anchor.trim() ? anchor.trim() : null;
}

/**
 * Performs a Rewind and then the send that carries it.
 *
 * Unlike Claude's, this cannot ride inside the send: `resumeSessionAt` is an
 * option on the SDK query, but OpenCode's revert is an immediate call of its
 * own, so a Rewind here is **two** operations and the atomicity Claude gets for
 * free has to be built. The revert is inclusive of the Anchor it names (see
 * `buildOpenCodeRewindAnchorIndex`) and restores tracked files along with the
 * conversation, which is why the composer warns about the files first.
 *
 * If the send fails after the revert succeeded, the reader would be left with
 * rolled-back files and nothing to show for it, so the revert is undone where
 * OpenCode still allows it (see `undoOpenCodeRewind` for when it does not) and
 * they are told either way — their working tree moved, and silence about that
 * is not an option.
 *
 * Exported for `opencode-runtime.provider.js`, which hands a send here instead
 * of assembling CLI arguments whenever that send carries an Anchor.
 */
export async function runOpenCodeRewindSend(
  command: string,
  options: AnyRecord,
  ws: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
  anchor: string,
): Promise<unknown> {
  const { sessionId, projectPath, cwd } = options;
  const workingDir = cwd || projectPath || process.cwd();
  const providerSessionId = context.resolveProviderSessionId(sessionId);

  const sendError = (content: string) => {
    ws.send(createNormalizedMessage({
      kind: 'error',
      content,
      sessionId: sessionId || null,
      provider: 'opencode',
    }));
  };
  const finishFailed = () => {
    ws.send(createCompleteMessage({
      provider: 'opencode',
      sessionId: sessionId || null,
      exitCode: 1,
    }));
  };

  if (!providerSessionId) {
    sendError('Nothing to rewind to yet — start a conversation first.');
    finishFailed();
    return;
  }

  try {
    await revertOpenCodeSession(providerSessionId, workingDir, anchor);
  } catch (error) {
    const errorContent = error instanceof Error ? error.message : String(error);
    console.error('[OpenCode] Rewind failed before the send:', errorContent);
    sendError(`Rewind failed, so nothing was sent: ${errorContent}`);
    finishFailed();
    return;
  }

  try {
    // An ordinary send from here on, minus the Anchor that brought it here —
    // dropping it is what stops this branch from being taken a second time.
    return await spawnOpenCode(command, { ...options, resumeSessionAt: undefined }, ws, context);
  } catch (error) {
    try {
      sendError(await undoOpenCodeRewind(providerSessionId, workingDir, anchor)
        ? 'The send failed, so the Rewind was undone — the conversation and your files are back where they were.'
        : 'The send failed, and OpenCode had already applied the Rewind by then — the earlier messages are gone and your files are still rolled back to that point.');
    } catch (undoError) {
      const undoContent = undoError instanceof Error ? undoError.message : String(undoError);
      console.error('[OpenCode] Rewind could not be undone after a failed send:', undoContent);
      sendError(`The send failed and the Rewind could not be undone (${undoContent}). Your files are still rolled back to the earlier point.`);
    }
    throw error;
  }
}
