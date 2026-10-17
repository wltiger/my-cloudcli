import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AnyRecord, ProviderModelsDefinition } from '@/shared/types.js';

// Everything below is imported dynamically inside the test, after the module
// mocks are installed: the websocket and database barrels transitively pull in
// the providers barrel — and with it the real Claude Agent SDK — so a static
// import here would cache the runtime before it could be mocked.

const MODELS: ProviderModelsDefinition = {
  OPTIONS: [{ value: 'default', label: 'Default' }, { value: 'opus', label: 'Opus' }],
  DEFAULT: 'default',
};

/** Lets every pending microtask, immediate and I/O callback run before asserting. */
async function flush(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Waits for a condition the runtime reaches asynchronously (its startup reads
 * the MCP config off disk, so no fixed number of ticks is reliable).
 */
async function waitUntil(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

/** Collects the JSON frames a run's writer forwards, like a browser socket. */
class FakeConnection {
  readyState = 1;
  frames: AnyRecord[] = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as AnyRecord);
  }

  kinds(): string[] {
    return this.frames.map((frame) => String(frame.kind));
  }
}

/**
 * Stand-in for one `query()` call: yields the events the test emits and drains
 * the prompt stream the way the SDK drains the CLI's stdin — when that stream
 * ends the process exits, so the message stream ends with it.
 */
type FakeQuery = {
  options: AnyRecord;
  prompts: AnyRecord[];
  promptStreamClosed: boolean;
  interruptCount: number;
  stoppedTasks: string[];
  stopTask(taskId: string): Promise<void>;
  emit(event: AnyRecord): Promise<void>;
  interrupt(): Promise<void>;
  [Symbol.asyncIterator](): AsyncGenerator<AnyRecord>;
};

const queries: FakeQuery[] = [];

function createFakeQuery({ prompt, options }: { prompt: AsyncIterable<AnyRecord>; options: AnyRecord }): FakeQuery {
  const events: AnyRecord[] = [];
  let wake: (() => void) | null = null;
  let exited = false;

  const resume = (): void => {
    const pending = wake;
    wake = null;
    pending?.();
  };

  const instance: FakeQuery = {
    options,
    prompts: [],
    promptStreamClosed: false,
    interruptCount: 0,
    stoppedTasks: [],
    async stopTask(taskId) {
      instance.stoppedTasks.push(taskId);
    },
    async emit(event) {
      events.push(event);
      resume();
      await flush();
    },
    async interrupt() {
      instance.interruptCount += 1;
      exited = true;
      resume();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (events.length > 0) {
          yield events.shift() as AnyRecord;
        }
        if (exited) {
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };

  void (async () => {
    for await (const message of prompt) {
      instance.prompts.push(message);
    }
    instance.promptStreamClosed = true;
    exited = true;
    resume();
  })();

  queries.push(instance);
  return instance;
}

const backgroundNotifications: AnyRecord[] = [];

function createContext(models: ProviderModelsDefinition = MODELS): AnyRecord {
  return {
    resolveProviderSessionId: () => undefined,
    resolveResumeModel: async (_sessionId: string | undefined, model: string | undefined) => model,
    getProviderModels: async () => models,
    normalizeMessage: (message: AnyRecord, sessionId: string) =>
      (message.type === 'assistant'
        ? [{ kind: 'text', role: 'assistant', provider: 'claude', sessionId, content: 'reply' }]
        : []),
    isProviderInstalled: async () => true,
  };
}

const BASE_OPTIONS: AnyRecord = {
  model: 'default',
  images: [],
  files: [],
  toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: false },
};

const BACKGROUND_BASH: AnyRecord = {
  type: 'assistant',
  session_id: 'provider-1',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', name: 'Bash', input: { command: 'sleep 100', run_in_background: true } }],
  },
};

// What the SDK streams once the CLI has registered that command as a task
// (every backgrounded command, agent and workflow gets one), and when it ends.
const BACKGROUND_BASH_STARTED: AnyRecord = {
  type: 'system',
  subtype: 'task_started',
  session_id: 'provider-1',
  task_id: 'bash-1',
  tool_use_id: 'toolu_bash',
  task_type: 'local_bash',
  description: 'sleep 100',
};
const BACKGROUND_BASH_COMPLETED: AnyRecord = {
  type: 'system',
  subtype: 'task_notification',
  session_id: 'provider-1',
  task_id: 'bash-1',
  tool_use_id: 'toolu_bash',
  status: 'completed',
};

let closeConnection: typeof import('@/modules/database/index.js')['closeConnection'];
let initializeDatabase: typeof import('@/modules/database/index.js')['initializeDatabase'];
let sessionsDb: typeof import('@/modules/database/index.js')['sessionsDb'];
let chatRunRegistry: typeof import('@/modules/websocket/index.js')['chatRunRegistry'];
let connectedClients: typeof import('@/modules/websocket/index.js')['connectedClients'];

function startRun(appSessionId: string, connection: FakeConnection) {
  const run = chatRunRegistry.startRun({
    appSessionId,
    provider: 'claude',
    providerSessionId: null,
    connection,
    userId: 'user-1',
  });
  assert.ok(run, `expected a new run for ${appSessionId}`);
  return run;
}

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'claude-held-turn-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
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

test('Claude held-process reuse across turns', async (t) => {
  t.mock.module('@anthropic-ai/claude-agent-sdk', {
    // `forkSession`/`getSessionMessages` are unused here, but the providers
    // barrel imports them, and a mocked module must provide every export its
    // importers name.
    namedExports: {
      query: createFakeQuery,
      forkSession: () => {
        throw new Error('forkSession is not part of these tests');
      },
      getSessionMessages: () => {
        throw new Error('getSessionMessages is not part of these tests');
      },
    },
  });
  // Mocked one level below the notifications barrel, which the runtime imports:
  // replacing the barrel itself would drop the unrelated exports its other
  // importers name. Delivery needs a user row and push channels; only the
  // decision to report background work matters here.
  t.mock.module('@/modules/notifications/services/notification-orchestrator.service.js', {
    namedExports: {
      buildNotificationPayload: () => ({}),
      createNotificationEvent: (event: AnyRecord) => event,
      notifyUserIfEnabled: () => {},
      notifyRunStopped: () => {},
      notifyRunFailed: () => {},
      notifyPermissionResolved: () => {},
      notifyBackgroundWorkCompleted: (payload: AnyRecord) => {
        backgroundNotifications.push(payload);
      },
    },
  });

  const database = await import('@/modules/database/index.js');
  closeConnection = database.closeConnection;
  initializeDatabase = database.initializeDatabase;
  sessionsDb = database.sessionsDb;
  ({ chatRunRegistry, connectedClients } = await import('@/modules/websocket/index.js'));

  const { queryClaudeSDK } = await import('@/modules/providers/list/claude/claude-runtime.provider.js');

  t.beforeEach(() => {
    queries.length = 0;
    backgroundNotifications.length = 0;
  });

  await t.test('a same-settings follow-up is pushed into the held process', async () => {
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-reuse', 'claude', '/workspace/demo');

      const first = new FakeConnection();
      const firstRun = startRun('app-reuse', first);
      const firstTurn = queryClaudeSDK('first question', { ...BASE_OPTIONS, sessionId: 'app-reuse' }, firstRun.writer, createContext());
      await waitUntil(() => queries.length === 1, 'the first query to start');

      const live = queries[0];
      assert.ok(live);

      await live.emit(BACKGROUND_BASH);
      await live.emit(BACKGROUND_BASH_STARTED);
      await live.emit({ type: 'result', session_id: 'provider-1' });

      assert.equal(live.promptStreamClosed, false, 'the process stays held for the background command');
      assert.deepEqual(first.kinds(), ['text', 'complete']);

      // Second turn, identical settings: a brand-new run in the registry.
      const second = new FakeConnection();
      const secondRun = startRun('app-reuse', second);
      const secondTurn = queryClaudeSDK('second question', { ...BASE_OPTIONS, sessionId: 'app-reuse' }, secondRun.writer, createContext());
      await waitUntil(() => live.prompts.length === 2 || queries.length > 1, 'the follow-up prompt to be pushed');

      assert.equal(queries.length, 1, 'the SDK query is constructed exactly once across both prompts');
      assert.equal(live.interruptCount, 0, 'the held process is not interrupted');
      assert.equal(live.prompts.length, 2, 'the follow-up prompt reached the held input stream');
      assert.match(JSON.stringify(live.prompts[1]), /second question/);

      // A second tab subscribing mid-turn joins the reused turn like any other.
      const watcher = new FakeConnection();
      assert.equal(chatRunRegistry.attachConnection('app-reuse', watcher), true);

      await live.emit({
        type: 'assistant',
        session_id: 'provider-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'answering' }] },
      });
      await live.emit({ type: 'result', session_id: 'provider-1' });
      await secondTurn;

      // The reused turn's events belong to the run waiting for them.
      assert.deepEqual(second.kinds(), ['text', 'complete']);
      assert.deepEqual(watcher.kinds(), ['text', 'complete'], 'a late subscriber sees the reused turn live');
      assert.deepEqual(first.kinds(), ['text', 'complete'], 'the stale first run receives nothing further');
      assert.equal(second.frames[0]?.seq, 1, 'the new run sequences the reused turn from its own start');
      assert.deepEqual(
        chatRunRegistry.replayEvents('app-reuse', 0).map((event) => event.kind),
        ['text', 'complete'],
        'the new run buffers the reused turn for replay',
      );

      assert.equal(live.promptStreamClosed, false, 'the background command survives the follow-up turn');
      assert.deepEqual(backgroundNotifications, [], 'answering the user is not reported as background work completing');

      // The background command finally reports back: now the process is let go.
      await live.emit(BACKGROUND_BASH_COMPLETED);
      await live.emit({ type: 'result', session_id: 'provider-1' });
      assert.equal(backgroundNotifications.length, 1, 'an unprompted turn is reported as background work completing');
      await firstTurn;
      assert.equal(live.promptStreamClosed, true);
    });
  });

  await t.test('a follow-up with changed settings supersedes the held process', async () => {
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-changed', 'claude', '/workspace/demo');

      const first = new FakeConnection();
      const firstRun = startRun('app-changed', first);
      const firstTurn = queryClaudeSDK('first question', { ...BASE_OPTIONS, sessionId: 'app-changed' }, firstRun.writer, createContext());
      await waitUntil(() => queries.length === 1, 'the first query to start');

      const live = queries[0];
      assert.ok(live);
      await live.emit(BACKGROUND_BASH);
      await live.emit({ type: 'result', session_id: 'provider-1' });
      assert.equal(live.promptStreamClosed, false);

      const second = new FakeConnection();
      const secondRun = startRun('app-changed', second);
      const secondTurn = queryClaudeSDK(
        'second question',
        { ...BASE_OPTIONS, sessionId: 'app-changed', model: 'opus' },
        secondRun.writer,
        createContext(),
      );
      await waitUntil(() => queries.length === 2, 'the superseding query to start');
      await flush();

      assert.equal(queries.length, 2, 'changed settings need their own query');
      assert.equal(live.promptStreamClosed, true, 'the previous hold is released');

      await queries[1]?.emit({ type: 'result', session_id: 'provider-1' });
      await Promise.all([firstTurn, secondTurn]);
    });
  });

  await t.test('a send that cannot keep a process running background work is refused, and the process is left alone', async () => {
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-refused', 'claude', '/workspace/demo');

      const first = new FakeConnection();
      const firstRun = startRun('app-refused', first);
      const firstTurn = queryClaudeSDK('first question', { ...BASE_OPTIONS, sessionId: 'app-refused' }, firstRun.writer, createContext());
      await waitUntil(() => queries.length === 1, 'the first query to start');

      const live = queries[0];
      assert.ok(live);
      await live.emit(BACKGROUND_BASH_STARTED);
      await live.emit({ type: 'result', session_id: 'provider-1' });

      const second = new FakeConnection();
      const secondRun = startRun('app-refused', second);
      await queryClaudeSDK(
        'second question',
        { ...BASE_OPTIONS, sessionId: 'app-refused', model: 'opus' },
        secondRun.writer,
        createContext(),
      );
      await flush();

      assert.equal(queries.length, 1, 'the refused send starts no process of its own');
      assert.equal(live.promptStreamClosed, false, 'and the held process is not released');
      const refusal = second.frames.find((frame) => frame.code === 'background_work_not_kept');
      assert.equal(refusal?.kind, 'error', 'the client is told why');
      // The chat handler completes a refused run, as it does any run that ends without a result.
      secondRun.writer.sendComplete({ exitCode: 1 });

      // The work reports back, so the same send now supersedes the hold as before.
      await live.emit(BACKGROUND_BASH_COMPLETED);
      const third = new FakeConnection();
      const thirdRun = startRun('app-refused', third);
      const thirdTurn = queryClaudeSDK(
        'third question',
        { ...BASE_OPTIONS, sessionId: 'app-refused', model: 'opus' },
        thirdRun.writer,
        createContext(),
      );
      await waitUntil(() => queries.length === 2, 'the superseding query to start');
      assert.equal(live.promptStreamClosed, true, 'the previous hold is released once nothing is outstanding');

      await queries[1]?.emit({ type: 'result', session_id: 'provider-1' });
      await Promise.all([firstTurn, thirdTurn]);
    });
  });

  await t.test('interrupt and send stops the outstanding task and releases the held process, even when the settings match', async () => {
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-interrupt', 'claude', '/workspace/demo');

      const first = new FakeConnection();
      const firstRun = startRun('app-interrupt', first);
      const firstTurn = queryClaudeSDK('first question', { ...BASE_OPTIONS, sessionId: 'app-interrupt' }, firstRun.writer, createContext());
      await waitUntil(() => queries.length === 1, 'the first query to start');

      const live = queries[0];
      assert.ok(live);
      await live.emit(BACKGROUND_BASH_STARTED);
      await live.emit({ type: 'result', session_id: 'provider-1' });

      const second = new FakeConnection();
      const secondRun = startRun('app-interrupt', second);
      const secondTurn = queryClaudeSDK(
        'second question',
        { ...BASE_OPTIONS, sessionId: 'app-interrupt', interruptBackground: true },
        secondRun.writer,
        createContext(),
      );
      await waitUntil(() => queries.length === 2, 'the interrupting query to start');

      assert.deepEqual(live.stoppedTasks, ['bash-1'], 'the outstanding task is stopped');
      assert.equal(live.promptStreamClosed, true, 'and the held process is released');
      assert.equal(second.frames.find((frame) => frame.code === 'background_work_not_kept'), undefined, 'the interrupt is never refused');

      await queries[1]?.emit({ type: 'result', session_id: 'provider-1' });
      await Promise.all([firstTurn, secondTurn]);
    });
  });

  await t.test('a turn with no background work releases its process immediately', async () => {
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-plain', 'claude', '/workspace/demo');

      const connection = new FakeConnection();
      const run = startRun('app-plain', connection);
      const turn = queryClaudeSDK('hello', { ...BASE_OPTIONS, sessionId: 'app-plain' }, run.writer, createContext());
      await waitUntil(() => queries.length === 1, 'the query to start');

      const live = queries[0];
      assert.ok(live);
      await live.emit({ type: 'result', session_id: 'provider-1' });
      await turn;

      assert.equal(live.promptStreamClosed, true, 'nothing outstanding, so stdin closes as before');
      assert.deepEqual(connection.kinds(), ['complete']);
      assert.equal(queries.length, 1);
      assert.deepEqual(backgroundNotifications, []);
    });
  });
});
