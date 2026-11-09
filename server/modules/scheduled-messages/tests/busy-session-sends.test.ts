import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, scheduledMessagesDb, sessionDraftsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { dispatchDueScheduledMessages, dispatchQueuedMessages } from '@/modules/scheduled-messages/services/scheduled-message-dispatcher.service.js';
import { chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';

/**
 * Seam: the dispatcher passes and `runDetachedChatTurn`, with a runtime that
 * can refuse the way the Claude runtime does when the process holding a
 * session's background work cannot take a message (fork entry 29). Pins the
 * behaviour of fork entry 31 for sends nobody is watching: a message queued
 * during a turn goes into the held process; a refused one waits for the work;
 * a scheduled message is either sent on time (stopping the work if it must)
 * or waits.
 */

const SESSION_ID = 'busy-session';

async function withIsolatedDatabase(runTest: (userId: number) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'busy-session-sends-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const user = userDb.createUser('busy-user', 'hash');
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Busy session');
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

/**
 * A runtime whose held process refuses every push that does not stop the
 * work, while `refuses()` says so — what the Claude runtime does when a
 * setting changed since the process was spawned.
 */
function createRuntime(runs: RunCall[], state: { background: boolean; refuses: boolean }) {
  return {
    hasRuntime: () => true,
    hasBackgroundWork: (sessionId: string) => sessionId === SESSION_ID && state.background,
    run: async (_provider: string, command: string, options: Record<string, unknown>, writer: { send: (message: unknown) => void }) => {
      runs.push({ command, options });
      if (state.refuses && options.interruptBackground !== true) {
        writer.send({ kind: 'error', code: 'background_work_not_kept', content: 'cannot join it', sessionId: SESSION_ID, provider: 'claude' });
        return;
      }
      if (options.interruptBackground === true) {
        state.background = false;
      }
    },
    abort: async () => true,
  } as never;
}

/** A finished turn: the session is idle, whatever its background work is doing. */
function finishedTurn(userId: number): void {
  const run = chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId });
  run!.writer.sendComplete({ exitCode: 0 });
}

const status = (userId: number) => scheduledMessagesDb.listForSession(userId, SESSION_ID)[0]?.status;
const queued = (userId: number) => sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage as { content?: string; waitFor?: string } | null | undefined;

test('queued messages keep what they wait for, and a joined turn waits for background work if either part did', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'A', attachments: [], waitFor: 'turn' });
    assert.equal(queued(userId)?.waitFor, 'turn');

    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'B', attachments: [], waitFor: 'background' });
    const joined = queued(userId);
    assert.equal(joined?.content, 'A\n\nB');
    assert.equal(joined?.waitFor, 'background');
  });
});

test('a message queued during a turn goes into the held process; refused, it waits for the background work and is not pushed again', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, { text: '', queuedMessage: { content: 'next step', waitFor: 'turn' } });
    finishedTurn(userId);
    const runs: RunCall[] = [];
    const state = { background: true, refuses: true };
    const runtime = createRuntime(runs, state);

    assert.equal(await dispatchQueuedMessages(runtime), 1, 'pushed while the work runs');
    assert.equal(runs.length, 1);
    assert.equal(queued(userId)?.waitFor, 'background', 'refused: back in the queue, waiting');

    assert.equal(await dispatchQueuedMessages(runtime), 0, 'not pushed again');
    assert.equal(runs.length, 1);

    // The work ends, and with it the hold: nothing is left to refuse a send.
    state.background = false;
    state.refuses = false;
    assert.equal(await dispatchQueuedMessages(runtime), 1, 'sent once the work has ended');
    assert.equal(runs.length, 2);
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('a message queued during a turn that the held process takes is sent and gone', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, { text: '', queuedMessage: { content: 'next step', waitFor: 'turn' } });
    finishedTurn(userId);
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs, { background: true, refuses: false });

    assert.equal(await dispatchQueuedMessages(runtime), 1);
    assert.equal(runs[0]?.options.interruptBackground, undefined, 'nothing is stopped');
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('a scheduled message sent on time stops the background work when the held process refuses it', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesDb.create({ userId, sessionId: SESSION_ID, content: 'at nine', options: {}, scheduledFor: new Date(Date.now() - 1000) });
    finishedTurn(userId);
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs, { background: true, refuses: true });

    assert.equal(await dispatchDueScheduledMessages(runtime), 1);
    assert.equal(runs.length, 2, 'pushed first, then sent stopping the work');
    assert.equal(runs[0]?.options.interruptBackground, undefined);
    assert.equal(runs[1]?.options.interruptBackground, true);
    assert.equal(status(userId), 'sent');
  });
});

test('a scheduled message refused even after stopping the work is recorded as failed, not dropped', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesDb.create({ userId, sessionId: SESSION_ID, content: 'at nine', options: {}, scheduledFor: new Date(Date.now() - 1000) });
    finishedTurn(userId);
    const runs: RunCall[] = [];
    const runtime = {
      hasRuntime: () => true,
      hasBackgroundWork: () => true,
      run: async (_provider: string, command: string, options: Record<string, unknown>, writer: { send: (message: unknown) => void }) => {
        runs.push({ command, options });
        writer.send({ kind: 'error', code: 'background_work_not_kept', content: 'cannot join it', sessionId: SESSION_ID, provider: 'claude' });
      },
      abort: async () => true,
    } as never;

    await dispatchDueScheduledMessages(runtime);
    assert.equal(runs.length, 2);
    assert.equal(status(userId), 'failed');
  });
});

test('a scheduled message set to wait stays scheduled while a turn runs, and through a refused push until the work ends', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesDb.create({ userId, sessionId: SESSION_ID, content: 'when free', options: { onBusy: 'wait', model: 'opus' }, scheduledFor: new Date(Date.now() - 1000) });
    const runs: RunCall[] = [];
    const state = { background: true, refuses: true };
    const runtime = createRuntime(runs, state);

    // A turn in flight: not claimed at all.
    const turn = chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId });
    assert.equal(await dispatchDueScheduledMessages(runtime), 0);
    assert.equal(runs.length, 0);
    assert.equal(status(userId), 'pending');

    // The turn ends with background work still running: pushed once, refused,
    // back on the schedule.
    turn!.writer.sendComplete({ exitCode: 0 });
    await dispatchDueScheduledMessages(runtime);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.options.onBusy, undefined, 'the setting is for the dispatcher, not the runtime');
    assert.equal(runs[0]?.options.model, 'opus');
    assert.equal(status(userId), 'pending');

    assert.equal(await dispatchDueScheduledMessages(runtime), 0, 'not pushed again while the work runs');
    assert.equal(runs.length, 1);

    state.background = false;
    state.refuses = false;
    assert.equal(await dispatchDueScheduledMessages(runtime), 1);
    assert.equal(runs.length, 2);
    assert.equal(runs[1]?.options.interruptBackground, undefined, 'it never stops anything');
    assert.equal(status(userId), 'sent');
  });
});
