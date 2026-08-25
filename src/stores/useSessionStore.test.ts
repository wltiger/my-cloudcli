import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToString } from 'react-dom/server';

import { SESSION_MESSAGES_PAGE_SIZE } from './sessionMessagePagination';
import { useSessionStore, type NormalizedMessage } from './useSessionStore';

const SESSION_ID = 'session-rewind';
const PAGE = SESSION_MESSAGES_PAGE_SIZE;

function at(second: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
}

/** A persisted row as the transcript reader emits it: Anchors already attached. */
function persisted(number: number): NormalizedMessage {
  const role = number % 2 === 1 ? 'user' : 'assistant';
  return {
    id: `m${number}`,
    sessionId: SESSION_ID,
    timestamp: at(number),
    provider: 'claude',
    kind: 'text',
    role,
    content: `${role} message ${number}`,
    anchor: `row-${number}`,
    ...(role === 'user' ? { rewindAnchor: `row-${number - 1}` } : {}),
  } as NormalizedMessage;
}

function range(start: number, end: number): NormalizedMessage[] {
  return Array.from({ length: end - start + 1 }, (_, index) => persisted(start + index));
}

/**
 * Serves session history the way the backend does: it reads the whole
 * transcript, drops the branch a Rewind abandoned, counts what is left, and
 * only then slices a tail page (`sliceTailPage`, server/shared/utils.ts). So
 * `total` always describes the surviving conversation, never the file.
 */
function serveTranscript(getTranscript: () => NormalizedMessage[]): () => void {
  const realFetch = globalThis.fetch;
  const realStorage = (globalThis as { localStorage?: unknown }).localStorage;
  // `authenticatedFetch` reads the auth token before every request, and Node
  // has no Web Storage. Without this the fetch throws, the store records an
  // error, and every assertion below passes against an empty list.
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  globalThis.fetch = (async (url: string) => {
    const params = new URL(url, 'http://localhost').searchParams;
    const transcript = getTranscript();
    const limit = params.has('limit') ? Number(params.get('limit')) : null;
    const offset = Number(params.get('offset') ?? 0);
    const end = Math.max(0, transcript.length - offset);
    const start = limit === null ? 0 : Math.max(0, end - limit);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        success: true,
        data: {
          messages: transcript.slice(start, end),
          total: transcript.length,
          hasMore: start > 0,
        },
      }),
    };
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = realFetch;
    (globalThis as { localStorage?: unknown }).localStorage = realStorage;
  };
}

/** The store is plain hooks over refs, so one SSR render is enough to drive it. */
function mountStore(): ReturnType<typeof useSessionStore> {
  let captured!: ReturnType<typeof useSessionStore>;
  function Probe() {
    captured = useSessionStore();
    return null;
  }
  renderToString(React.createElement(Probe));
  return captured;
}

/**
 * Opens a 60-message session, scrolls up once, then Rewinds to message 41:
 * the server drops 41..60 and the resent turn lands in their place.
 * Returns what the reader is left looking at.
 */
async function rewindLongSession(): Promise<NormalizedMessage[]> {
  const before = range(1, 60);
  const resentTurn: NormalizedMessage[] = [
    { ...persisted(41), id: 'm41b', timestamp: at(200) },
    { ...persisted(42), id: 'm42b', timestamp: at(201), content: 'reply after the rewind' },
  ];
  const after = [...before.slice(0, 40), ...resentTurn];

  let transcript = before;
  const restore = serveTranscript(() => transcript);
  try {
    const store = mountStore();
    store.setActiveSession(SESSION_ID);
    await store.fetchFromServer(SESSION_ID, { limit: PAGE, offset: 0 });
    await store.fetchMore(SESSION_ID, { limit: PAGE });
    // Guards every assertion below: a scenario that quietly failed to load
    // anything would satisfy all of them.
    assert.equal(store.getMessages(SESSION_ID).length, PAGE * 2);

    transcript = after;
    // The resent turn arrives over the socket first. Live rows carry no Anchor:
    // Anchors are read off the transcript, not off the stream.
    for (const message of resentTurn) {
      store.appendRealtime(SESSION_ID, {
        ...message,
        anchor: undefined,
        rewindAnchor: undefined,
      } as NormalizedMessage);
    }
    // The run ends and the persisted tail is reconciled.
    await store.refreshLatestFromServer(SESSION_ID, { limit: PAGE });

    return store.getMessages(SESSION_ID);
  } finally {
    restore();
  }
}

test('a Rewind drops the cached rows the server deleted', async () => {
  const visible = await rewindLongSession();

  // 41..60 are the branch the Rewind abandoned. Stitching a fresh page onto the
  // cache cannot find them -- they are gone server-side -- so before this was
  // fixed the stitch gave up and left every one of them on screen until reload.
  const abandoned = visible.filter((message) => /^m(4[1-9]|5\d|60)$/.test(message.id));
  assert.deepEqual(abandoned, []);

  assert.equal(visible.at(-1)?.content, 'reply after the rewind');
});

test('the resent turn keeps its Rewind and Fork anchors', async () => {
  const visible = await rewindLongSession();

  // Downstream of the same bug rather than a separate one: while the refresh
  // was giving up, the anchorless live rows were never superseded by the
  // persisted ones, so the turn the reader had just sent offered no Rewind or
  // Fork control at all.
  assert.deepEqual(visible.filter((message) => !message.anchor), []);
  assert.deepEqual(
    visible.filter((message) => message.role === 'user' && !message.rewindAnchor),
    [],
  );
});

/**
 * The same Rewind, but reached the way a reader actually reaches it: by
 * chatting. The turns that get abandoned streamed in over the socket first, so
 * the store holds them twice -- once persisted, once live.
 */
async function rewindAfterChattingLive(): Promise<NormalizedMessage[]> {
  const before = range(1, 60);
  const resentTurn: NormalizedMessage[] = [
    { ...persisted(41), id: 'm41b', timestamp: at(200) },
    { ...persisted(42), id: 'm42b', timestamp: at(201), content: 'reply after the rewind' },
  ];
  const after = [...before.slice(0, 40), ...resentTurn];

  let transcript = before;
  const restore = serveTranscript(() => transcript);
  try {
    const store = mountStore();
    store.setActiveSession(SESSION_ID);
    await store.fetchFromServer(SESSION_ID, { limit: PAGE, offset: 0 });
    await store.fetchMore(SESSION_ID, { limit: PAGE });

    // Turns 57..60 were watched live. The socket's ids are its own, so these do
    // not collide with the persisted rows they duplicate.
    for (const number of [57, 58, 59, 60]) {
      store.appendRealtime(SESSION_ID, {
        ...persisted(number),
        id: `live-${number}`,
        anchor: undefined,
        rewindAnchor: undefined,
      } as NormalizedMessage);
    }
    await store.refreshLatestFromServer(SESSION_ID, { limit: PAGE });
    // Guards the assertions below: they are only meaningful if the turns about
    // to be abandoned really are on screen, in both of their two copies.
    const beforeRewind = store.getMessages(SESSION_ID);
    assert.ok(beforeRewind.some((message) => message.id === 'm60'), 'persisted copy missing');
    assert.ok(beforeRewind.some((message) => message.id === 'live-57'), 'live copy missing');

    transcript = after;
    for (const message of resentTurn) {
      store.appendRealtime(SESSION_ID, {
        ...message,
        anchor: undefined,
        rewindAnchor: undefined,
      } as NormalizedMessage);
    }
    await store.refreshLatestFromServer(SESSION_ID, { limit: PAGE });

    return store.getMessages(SESSION_ID);
  } finally {
    restore();
  }
}

test('a Rewind also drops the abandoned turns that were watched live', async () => {
  const visible = await rewindAfterChattingLive();

  // Pruning only removes live rows the server still has, so rows the Rewind
  // deleted are exactly the ones it cannot recognise: they come straight back
  // as `extra` and the reader keeps seeing messages that no longer exist.
  // Matched by id, not by text: the resent message is a *re-send*, so it
  // legitimately carries the same words as the one the Rewind dropped.
  const abandoned = visible.filter((message) => /^(live-|m(4[3-9]|5\d|60)$)/.test(message.id));
  assert.deepEqual(abandoned.map((message) => message.id), []);
});
