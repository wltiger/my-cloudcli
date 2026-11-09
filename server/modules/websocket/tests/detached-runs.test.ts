import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb, userDb } from '@/modules/database/index.js';
import { chatRunRegistry, connectedClients, runDetachedChatTurn } from '@/modules/websocket/index.js';

/**
 * Seam: `runDetachedChatTurn` and the run registry, for the turns the server
 * starts on its own — a queued or scheduled message (fork entry 31). Such a
 * turn must tell its caller when the Claude runtime refused it, and must reach
 * every tab that has this session open, whether or not a run was going when
 * the tab subscribed.
 */

const SESSION_ID = 'detached-session';

async function withIsolatedDatabase(runTest: (userId: number) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'detached-runs-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const user = userDb.createUser('detached-user', 'hash');
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Detached session');
    await runTest(Number(user.id));
  } finally {
    chatRunRegistry.clearAll();
    connectedClients.clear();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

type RunCall = { command: string; options: Record<string, unknown> };

function refusingRuntime(runs: RunCall[]) {
  return {
    hasRuntime: () => true,
    hasBackgroundWork: () => true,
    run: async (_provider: string, command: string, options: Record<string, unknown>, writer: { send: (message: unknown) => void }) => {
      runs.push({ command, options });
      if (options.interruptBackground !== true) {
        writer.send({ kind: 'error', code: 'background_work_not_kept', content: 'cannot join it', sessionId: SESSION_ID, provider: 'claude' });
      }
    },
    abort: async () => true,
  } as never;
}

function openTab() {
  const frames: Array<Record<string, unknown>> = [];
  const tab = { readyState: 1, send: (data: string) => { frames.push(JSON.parse(data) as Record<string, unknown>); } };
  return { tab, frames };
}

const sawReply = (frames: Array<Record<string, unknown>>) => frames.some((frame) => frame.kind === 'text' && frame.content === 'the queued reply');

test('runDetachedChatTurn reports a refused push, and passes interruptBackground to the runtime', async () => {
  await withIsolatedDatabase(async (userId) => {
    const runs: RunCall[] = [];
    const runtime = refusingRuntime(runs);

    const refused = await runDetachedChatTurn({ sessionId: SESSION_ID, userId, content: 'hello' }, { runtime });
    assert.equal(refused.started, true);
    assert.equal(refused.refused, true);

    const sent = await runDetachedChatTurn({ sessionId: SESSION_ID, userId, content: 'hello', interruptBackground: true }, { runtime });
    assert.equal(sent.refused, false);
    assert.equal(runs[1]?.options.interruptBackground, true, 'on the top level of the runtime options');
  });
});

test('a run the server starts reaches the tab that watched the session\'s previous run', async () => {
  await withIsolatedDatabase(async (userId) => {
    const { tab, frames } = openTab();
    const first = chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: tab as never, userId });
    first!.writer.sendComplete({ exitCode: 0 });

    const detached = chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId });
    detached!.writer.send({ kind: 'text', role: 'assistant', content: 'the queued reply', sessionId: SESSION_ID, provider: 'claude' });

    assert.ok(sawReply(frames), 'the open tab sees the reply live, not only after a reload');
  });
});

test('a run the server starts reaches a tab that opened the session while nothing was running', async () => {
  await withIsolatedDatabase(async (userId) => {
    // No run at all: the tab subscribed to an idle session (the previous run
    // long evicted), as when a scheduled message comes due hours later.
    const { tab, frames } = openTab();
    chatRunRegistry.watchSession(SESSION_ID, tab as never);

    const detached = chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId });
    detached!.writer.send({ kind: 'text', role: 'assistant', content: 'the queued reply', sessionId: SESSION_ID, provider: 'claude' });

    assert.ok(sawReply(frames));
  });
});

test('a closed tab is dropped, and a tab watching another session hears nothing', async () => {
  await withIsolatedDatabase(async (userId) => {
    const closed = openTab();
    const elsewhere = openTab();
    chatRunRegistry.watchSession(SESSION_ID, closed.tab as never);
    chatRunRegistry.watchSession('another-session', elsewhere.tab as never);
    closed.tab.readyState = 3;

    const detached = chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId });
    detached!.writer.send({ kind: 'text', role: 'assistant', content: 'the queued reply', sessionId: SESSION_ID, provider: 'claude' });

    assert.equal(closed.frames.length, 0);
    assert.equal(elsewhere.frames.length, 0);
  });
});
