import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AnyRecord, ProviderModelsDefinition } from '@/shared/types.js';

// Integration cover for the three mechanisms that have to agree before a
// subagent investigation can outlive the turn that started it:
//
//  - the Stop-hook ledger, which reports what is still in flight as a turn ends
//    (claude-background-work.ts),
//  - the held-turn registry, which lets the next prompt be pushed into the live
//    process instead of superseding it (claude-turn-reuse.ts),
//  - the runtime's own hold/release and output-routing decisions, which read
//    both.
//
// Each of those has unit cover of its own; what only shows up here is their
// composition — a turn whose background work survives the `result` *and* the
// follow-up prompt that arrives afterwards.
//
// Everything is imported dynamically inside the test, after the module mocks
// are installed: the websocket and database barrels transitively pull in the
// providers barrel — and with it the real Claude Agent SDK — so a static import
// would cache the runtime before it could be mocked.

const MODELS: ProviderModelsDefinition = {
  OPTIONS: [{ value: 'default', label: 'Default' }],
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
  for (let i = 0; i < 400; i += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

/**
 * Collects the frames a run receives, whether it stands in for a browser socket
 * behind a `ChatSessionWriter` (JSON text) or is handed to the runtime as the
 * writer itself (plain objects).
 */
class FakeConnection {
  readyState = 1;
  userId: string | null = null;
  frames: AnyRecord[] = [];

  send(data: string | AnyRecord): void {
    this.frames.push(typeof data === 'string' ? (JSON.parse(data) as AnyRecord) : data);
  }

  setSessionId(): void {}

  kinds(): string[] {
    return this.frames.map((frame) => String(frame.kind));
  }
}

/**
 * Stand-in for one `query()` call: yields the events the test emits and drains
 * the prompt stream the way the SDK drains the CLI's stdin — when that stream
 * ends the process exits, so the message stream ends with it. A held run stays
 * suspended here instead, which is what lets a follow-up prompt be pushed in.
 */
type FakeQuery = {
  options: AnyRecord;
  prompts: AnyRecord[];
  promptStreamClosed: boolean;
  interruptCount: number;
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

function createContext(): AnyRecord {
  return {
    resolveProviderSessionId: () => undefined,
    resolveResumeModel: async (_sessionId: string | undefined, model: string | undefined) => model,
    getProviderModels: async () => MODELS,
    normalizeMessage: (message: AnyRecord, sessionId: string) => {
      if (message.type === 'assistant') {
        return [{ kind: 'text', role: 'assistant', provider: 'claude', sessionId, content: 'reply' }];
      }
      if (message.type === 'system' && message.subtype === 'task_progress') {
        return [{ kind: 'status', text: 'task_progress', provider: 'claude', sessionId }];
      }
      return [];
    },
    isProviderInstalled: async () => true,
  };
}

const BASE_OPTIONS: AnyRecord = {
  model: 'default',
  images: [],
  files: [],
  toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: false },
};

const SUBAGENT_TOOL_USE_ID = 'toolu_agent_1';

function toolUse(name: string, input: AnyRecord): AnyRecord {
  return {
    type: 'assistant',
    session_id: 'provider-1',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: SUBAGENT_TOOL_USE_ID, name, input }] },
  };
}

const RESULT: AnyRecord = { type: 'result', session_id: 'provider-1' };

/** What the Stop hook reports for a delegation that is still working. */
const RUNNING_SUBAGENT = {
  id: 'a1',
  type: 'subagent',
  status: 'running',
  description: 'delegated investigation',
  agent_type: 'general-purpose',
};

/** What the Stop hook reports for a `Bash` call that was backgrounded. */
const RUNNING_SHELL = {
  id: 'b1',
  type: 'shell',
  status: 'running',
  command: 'npm run build',
};

/** Invokes a hook the runtime registered, the way the SDK's control channel does. */
async function fireStop(live: FakeQuery, backgroundTasks: AnyRecord[]): Promise<void> {
  const matchers = live.options.hooks?.Stop as AnyRecord[] | undefined;
  const callback = matchers?.[0]?.hooks?.[0] as ((input: AnyRecord) => Promise<unknown>) | undefined;
  assert.ok(callback, 'expected a registered Stop hook');
  await callback({
    hook_event_name: 'Stop',
    session_id: 'provider-1',
    background_tasks: backgroundTasks,
    session_crons: [],
  });
  await flush();
}

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
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'claude-subagent-survival-'));

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

test('Claude subagent work surviving a turn boundary and the next prompt', async (t) => {
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
  // Mocked one level below the notifications barrel the runtime imports, so the
  // barrel's other exports keep working for its other importers. Delivery needs
  // a user row and push channels; only the decision to report background work
  // as finished matters here.
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

  await t.test('a running subagent survives its own turn and the next prompt', async () => {
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-subagent', 'claude', '/workspace/demo');

      const first = new FakeConnection();
      const firstRun = startRun('app-subagent', first);
      const firstTurn = queryClaudeSDK(
        'investigate the flaky test',
        { ...BASE_OPTIONS, sessionId: 'app-subagent' },
        firstRun.writer,
        createContext(),
      );
      await waitUntil(() => queries.length === 1, 'the first query to start');

      const live = queries[0];
      assert.ok(live);

      // A delegation the tool-name fallback deliberately does not recognise:
      // only the Stop snapshot can report that it is still working.
      await live.emit(toolUse('Agent', { subagent_type: 'general-purpose', prompt: 'dig in' }));
      await fireStop(live, [RUNNING_SUBAGENT]);
      await live.emit(RESULT);

      assert.equal(live.promptStreamClosed, false, 'the subagent keeps the process held past its turn');
      assert.deepEqual(first.kinds(), ['text', 'complete'], 'the user is told the turn finished all the same');

      // The turn is over and the session is not processing, yet the work is
      // alive — the two states the UI has to be able to tell apart, so that Stop
      // stays reachable and the transcript keeps refreshing without any of it
      // standing in the way of the follow-up prompt below.
      assert.equal(chatRunRegistry.isProcessing('app-subagent'), false);
      assert.equal(chatRunRegistry.hasBackgroundWorkOutstanding('app-subagent'), true);

      // The follow-up: unchanged settings, so it belongs in the live process.
      const second = new FakeConnection();
      const secondRun = startRun('app-subagent', second);
      const secondTurn = queryClaudeSDK(
        'meanwhile, what does the config say?',
        { ...BASE_OPTIONS, sessionId: 'app-subagent' },
        secondRun.writer,
        createContext(),
      );
      await waitUntil(() => live.prompts.length === 2 || queries.length > 1, 'the follow-up prompt to be pushed');

      assert.equal(queries.length, 1, 'the follow-up reuses the process rather than building a second one');
      assert.equal(live.interruptCount, 0, 'the subagent is never interrupted by a superseding run');
      assert.equal(live.promptStreamClosed, false, 'the follow-up did not close the held stdin');
      assert.match(JSON.stringify(live.prompts[1]), /what does the config say/);

      // Subagent traffic arriving on the same process *after* the push has to
      // follow the writer rebinding, or the investigation goes silent exactly
      // when the user starts watching the new turn.
      await live.emit({
        type: 'system',
        subtype: 'task_progress',
        session_id: 'provider-1',
        parent_tool_use_id: SUBAGENT_TOOL_USE_ID,
        task_id: 'a1',
        description: 'still reading the transcript',
      });
      await live.emit({
        type: 'assistant',
        session_id: 'provider-1',
        parent_tool_use_id: SUBAGENT_TOOL_USE_ID,
        message: { role: 'assistant', content: [{ type: 'text', text: 'found three candidates' }] },
      });

      const subagentFrames = second.frames.filter((frame) => frame.parentToolUseId === SUBAGENT_TOOL_USE_ID);
      assert.deepEqual(
        subagentFrames.map((frame) => String(frame.kind)),
        ['status', 'text'],
        'the subagent keeps reporting into the run the user is watching',
      );
      assert.deepEqual(first.kinds(), ['text', 'complete'], 'and no longer into the finished run');

      // The follow-up's own answer, with the subagent still working.
      await live.emit({
        type: 'assistant',
        session_id: 'provider-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'the config sets retries to 3' }] },
      });
      await fireStop(live, [RUNNING_SUBAGENT]);
      await live.emit(RESULT);
      await secondTurn;

      assert.equal(second.kinds().at(-1), 'complete', 'the follow-up is answered on the reused process');
      assert.equal(live.promptStreamClosed, false, 'and the subagent survives the follow-up turn too');
      assert.deepEqual(backgroundNotifications, [], 'answering the user is not the background work reporting back');

      // The window the user actually sits in: the follow-up turn has reported
      // complete, so its run is marked completed and queued for eviction, and
      // the subagent is the only thing still producing anything. Nothing rebinds
      // `ws` again here, so this is the half of the hold where a writer that
      // stopped forwarding after its terminal event would go silent unnoticed.
      await live.emit({
        type: 'system',
        subtype: 'task_progress',
        session_id: 'provider-1',
        parent_tool_use_id: SUBAGENT_TOOL_USE_ID,
        task_id: 'a1',
        description: 'narrowing it down',
      });
      await live.emit({
        type: 'assistant',
        session_id: 'provider-1',
        parent_tool_use_id: SUBAGENT_TOOL_USE_ID,
        message: { role: 'assistant', content: [{ type: 'text', text: 'it is the retry timer' }] },
      });

      assert.deepEqual(
        second.kinds().slice(-2),
        ['status', 'text'],
        'the subagent keeps reporting after the follow-up turn has already completed',
      );
      assert.deepEqual(
        chatRunRegistry.replayEvents('app-subagent', 0).map((event) => event.kind).slice(-2),
        ['status', 'text'],
        'and a tab that reconnects during the hold replays them',
      );
      assert.deepEqual(first.kinds(), ['text', 'complete'], 'still nothing to the finished first run');

      // The investigation finally lands.
      await fireStop(live, []);
      await live.emit(RESULT);
      await firstTurn;

      assert.equal(live.promptStreamClosed, true, 'nothing outstanding, so the process is let go');
      assert.equal(backgroundNotifications.length, 1, 'and the user is told the investigation finished');
      assert.equal(
        chatRunRegistry.hasBackgroundWorkOutstanding('app-subagent'),
        false,
        'releasing the process also retires the hold the UI was showing',
      );
    });
  });

  /**
   * Drives a turn that backgrounds two different kinds of work at once — a
   * `Bash run_in_background` and an `Agent` delegation — then takes a follow-up
   * prompt into the process while both are outstanding, and finally clears them
   * one at a time.
   *
   * `survivor` is what the Stop hook still lists once the first of the pair has
   * reported back; running it both ways round is the point, since neither task
   * may be released on the other's account.
   */
  async function runMixedGroup(sessionId: string, survivor: AnyRecord): Promise<void> {
    sessionsDb.createAppSession(sessionId, 'claude', '/workspace/demo');

    const first = new FakeConnection();
    const firstRun = startRun(sessionId, first);
    const firstTurn = queryClaudeSDK(
      'build it and investigate the flaky test',
      { ...BASE_OPTIONS, sessionId },
      firstRun.writer,
      createContext(),
    );
    await waitUntil(() => queries.length === 1, `the query for ${sessionId} to start`);

    const live = queries[0];
    assert.ok(live);

    await live.emit(toolUse('Bash', { command: 'npm run build', run_in_background: true }));
    await live.emit(toolUse('Agent', { subagent_type: 'general-purpose', prompt: 'dig in' }));
    await fireStop(live, [RUNNING_SHELL, RUNNING_SUBAGENT]);
    await live.emit(RESULT);
    assert.equal(live.promptStreamClosed, false, 'two outstanding tasks hold the process');

    // The follow-up lands while the whole group is still running: it has to be
    // pushed into this process, because superseding it would kill both.
    const second = new FakeConnection();
    const secondRun = startRun(sessionId, second);
    const secondTurn = queryClaudeSDK(
      'while that runs, which config sets the retries?',
      { ...BASE_OPTIONS, sessionId },
      secondRun.writer,
      createContext(),
    );
    await waitUntil(() => live.prompts.length === 2 || queries.length > 1, 'the follow-up prompt to be pushed');

    assert.equal(queries.length, 1, 'a group of background work is reused into, not superseded');
    assert.equal(live.interruptCount, 0, 'neither the shell nor the subagent is interrupted');

    await live.emit({
      type: 'assistant',
      session_id: 'provider-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'retries live in vitest.config.ts' }] },
    });
    await fireStop(live, [RUNNING_SHELL, RUNNING_SUBAGENT]);
    await live.emit(RESULT);
    await secondTurn;

    assert.equal(second.kinds().at(-1), 'complete', 'the follow-up is answered on the reused process');
    assert.equal(live.promptStreamClosed, false, 'and the whole group survives it');
    assert.deepEqual(backgroundNotifications, [], 'answering the user is not the group reporting back');

    // The first of the pair reports back; the other is still running.
    await fireStop(live, [survivor]);
    await live.emit(RESULT);
    assert.equal(live.promptStreamClosed, false, 'one task settling must not release the other');
    assert.deepEqual(backgroundNotifications, [], 'the group has not finished yet');

    // And now the last one.
    await fireStop(live, []);
    await live.emit(RESULT);
    await firstTurn;
    assert.equal(live.promptStreamClosed, true, 'the hold ends with the last task');
    assert.equal(backgroundNotifications.length, 1, 'reported once, when the group finished');
  }

  await t.test('a mixed group survives a follow-up and holds until the shell settles last', async () => {
    await withIsolatedDatabase(async () => {
      await runMixedGroup('bg-mixed-shell-last', RUNNING_SHELL);
    });
  });

  await t.test('a mixed group survives a follow-up and holds until the subagent settles last', async () => {
    await withIsolatedDatabase(async () => {
      await runMixedGroup('bg-mixed-subagent-last', RUNNING_SUBAGENT);
    });
  });
});
