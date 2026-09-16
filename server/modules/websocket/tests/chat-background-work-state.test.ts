import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection, runDetachedChatTurn } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * "A turn is producing output" and "this session still holds background work"
 * are two independent states, and the whole point of splitting them is that only
 * the first one is allowed to keep a prompt out.
 *
 * Everything here pins that asymmetry from the outside: what the registry
 * admits, what the scheduled-message path interrupts, what Stop can reach, and
 * what a client is told — never internal bookkeeping, because the bug this
 * exists to prevent is precisely "we refused/aborted when we shouldn't have".
 */

const SESSION_ID = 'bg-work-session';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Record<string, unknown>);
  return socket;
}

type GatewayContext = {
  socket: ReturnType<typeof createFakeSocket>;
  runs: Array<{ command: string }>;
  aborts: string[];
  /** Parks the next provider run so a test can act while a turn is genuinely in flight. */
  holdNextRun: () => void;
  releaseHeldRun: () => void;
  /**
   * Makes the runtime report that it could not abort — what the Claude runtime
   * returns when `interrupt()` rejects and it therefore never closes the held
   * stdin, leaving the process (and its background work) alive.
   */
  failNextAborts: () => void;
  runtime: { runtime: unknown };
};

async function withGateway(runTest: (context: GatewayContext) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-bg-work-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const runs: Array<{ command: string }> = [];
  const aborts: string[] = [];
  let abortSucceeds = true;
  let holdRun: Promise<void> | null = null;
  // Boxed so the teardown below still sees whatever the test's own helpers set.
  const held: { release: (() => void) | null } = { release: null };
  const socket = createFakeSocket();

  const dependencies = {
    runtime: {
      hasRuntime: () => true,
      run: async (_provider: string, command: string) => {
        runs.push({ command });
        if (holdRun) {
          await holdRun;
        }
      },
      abort: async (_provider: string, sessionId: string) => {
        aborts.push(sessionId);
        return abortSucceeds;
      },
      getPendingApprovalsForSession: () => [],
      resolveToolApproval: () => {},
    } as never,
  };

  try {
    const now = new Date().toISOString();
    sessionsDb.createSession(SESSION_ID, 'claude', tempDirectory, 'Background work session', now, now, null);

    handleChatConnection(socket as never, { user: { id: 1 } } as never, dependencies as never);
    connectedClients.add(socket as never);

    await runTest({
      socket,
      runs,
      aborts,
      holdNextRun: () => {
        holdRun = new Promise<void>((resolve) => { held.release = resolve; });
      },
      releaseHeldRun: () => {
        held.release?.();
        held.release = null;
        holdRun = null;
      },
      failNextAborts: () => {
        abortSucceeds = false;
      },
      runtime: dependencies,
    });
  } finally {
    held.release?.();
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** The websocket listener does not await the async handlers it dispatches to. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });

test('startRun admits a new run while only background work is outstanding', async () => {
  await withGateway(async () => {
    chatRunRegistry.setBackgroundWorkOutstanding(SESSION_ID, true);

    // This is what makes the runtime's process-reuse path reachable at all: if
    // the registry refused here, the prompt that keeps the CLI process (and its
    // background children) alive could never be sent.
    const run = chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId: null,
    });

    assert.ok(run, 'a background-work-only session must still admit a run');
  });
});

test('background work outstanding does not make a session read as processing', async () => {
  await withGateway(async () => {
    chatRunRegistry.setBackgroundWorkOutstanding(SESSION_ID, true);

    // The scheduled-message dispatcher's send gate and its interrupt branch both
    // read `isProcessing`; folding background work into it would hold scheduled
    // messages back and abort the hold they should be delivered into.
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
    assert.equal(chatRunRegistry.hasBackgroundWorkOutstanding(SESSION_ID), true);
  });
});

test('a change in background-work state is announced once to every client', async () => {
  await withGateway(async ({ socket }) => {
    chatRunRegistry.setBackgroundWorkOutstanding(SESSION_ID, true);
    // Re-reporting the same state is not a change and must not put a frame on
    // the wire — a run re-parks after every turn it holds through.
    chatRunRegistry.setBackgroundWorkOutstanding(SESSION_ID, true);
    chatRunRegistry.setBackgroundWorkOutstanding(SESSION_ID, false);

    const deltas = socket.frames.filter((frame) => frame.kind === 'session_background_work');
    assert.deepEqual(
      deltas.map((frame) => frame.outstanding),
      [true, false],
    );
    assert.equal(deltas[0]?.sessionId, SESSION_ID);
  });
});

test('chat.subscribe reports background work alongside the processing state', async () => {
  await withGateway(async ({ socket }) => {
    chatRunRegistry.setBackgroundWorkOutstanding(SESSION_ID, true);

    socket.emit('message', JSON.stringify({
      type: 'chat.subscribe',
      sessions: [{ sessionId: SESSION_ID, lastSeq: 0 }],
    }));
    await settle();

    const ack = socket.frames.find((frame) => frame.kind === 'chat_subscribed');
    assert.ok(ack);
    // The two travel together and mean different things: nothing is running, but
    // work is still alive.
    assert.equal(ack?.isProcessing, false);
    assert.equal(ack?.backgroundWorkOutstanding, true);
  });
});

test('Stop reaches a session that is only holding background work', async () => {
  await withGateway(async ({ socket, aborts }) => {
    chatRunRegistry.setBackgroundWorkOutstanding(SESSION_ID, true);

    socket.emit('message', JSON.stringify({ type: 'chat.abort', sessionId: SESSION_ID }));
    await settle();

    // Before the split, Stop disappeared the instant a turn reported complete
    // and a held background task could not be aborted from the UI at all.
    assert.deepEqual(aborts, [SESSION_ID]);
    assert.equal(chatRunRegistry.hasBackgroundWorkOutstanding(SESSION_ID), false);
    assert.equal(
      socket.frames.filter((frame) => frame.kind === 'protocol_error').length,
      0,
      'stopping a held session is not a protocol error',
    );
  });
});

test('a Stop the runtime could not carry out leaves the work stoppable', async () => {
  await withGateway(async ({ socket, aborts, failNextAborts }) => {
    chatRunRegistry.setBackgroundWorkOutstanding(SESSION_ID, true);
    // The Claude runtime returns false when `interrupt()` rejects, and in that
    // path it never reaches the line that closes the held stdin — so the CLI
    // process, and the background work inside it, are still running.
    failNextAborts();

    socket.emit('message', JSON.stringify({ type: 'chat.abort', sessionId: SESSION_ID }));
    await settle();

    assert.equal(
      chatRunRegistry.hasBackgroundWorkOutstanding(SESSION_ID),
      true,
      'a failed abort must not retire a hold whose work is still running',
    );

    // The user can try again — which is the whole point. Retiring the state on a
    // failed abort would have taken Stop off the screen and left the work with
    // no way to be reached at all.
    socket.emit('message', JSON.stringify({ type: 'chat.abort', sessionId: SESSION_ID }));
    await settle();

    assert.deepEqual(aborts, [SESSION_ID, SESSION_ID]);
    assert.equal(
      socket.frames.filter((frame) => frame.kind === 'protocol_error').length,
      0,
      'the retry is accepted, not refused as "no active run"',
    );
  });
});

test('Stop is still refused for a session with nothing running and nothing held', async () => {
  await withGateway(async ({ socket, aborts }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.abort', sessionId: SESSION_ID }));
    await settle();

    assert.deepEqual(aborts, []);
    const error = socket.frames.find((frame) => frame.kind === 'protocol_error');
    assert.equal(error?.code, 'NO_ACTIVE_RUN');
  });
});

test('a scheduled message is delivered into a hold instead of aborting it', async () => {
  await withGateway(async ({ aborts, runs, runtime }) => {
    chatRunRegistry.setBackgroundWorkOutstanding(SESSION_ID, true);

    const result = await runDetachedChatTurn(
      {
        sessionId: SESSION_ID,
        userId: 1,
        content: 'scheduled follow-up',
        interruptActiveRun: true,
      },
      runtime as never,
    );

    assert.equal(result.started, true);
    assert.deepEqual(runs.map((run) => run.command), ['scheduled follow-up']);
    // The abort is what would have killed the background work; the turn goes
    // through the ordinary dispatch path, which the runtime routes into the
    // process it is already holding open.
    assert.deepEqual(aborts, []);
  });
});

test('a scheduled message still interrupts a turn that is genuinely in flight', async () => {
  await withGateway(async ({ socket, aborts, holdNextRun, releaseHeldRun, runtime }) => {
    holdNextRun();
    socket.emit('message', JSON.stringify({
      type: 'chat.send',
      sessionId: SESSION_ID,
      content: 'a long answer',
    }));
    await settle();
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true);

    const pending = runDetachedChatTurn(
      {
        sessionId: SESSION_ID,
        userId: 1,
        content: 'scheduled follow-up',
        interruptActiveRun: true,
      },
      runtime as never,
    );
    await settle();

    // Unchanged from before the split: the user picked this time on purpose.
    assert.deepEqual(aborts, [SESSION_ID]);

    releaseHeldRun();
    await pending;
  });
});
