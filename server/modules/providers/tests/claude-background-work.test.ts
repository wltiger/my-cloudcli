import assert from 'node:assert/strict';
import test from 'node:test';

import type { AnyRecord, ProviderModelsDefinition } from '@/shared/types.js';

// The runtime is imported dynamically inside the test, after the module mocks
// are installed: a static import here would cache the real Claude Agent SDK
// before it could be replaced.

const MODELS: ProviderModelsDefinition = {
  OPTIONS: [{ value: 'default', label: 'Default' }],
  DEFAULT: 'default',
};

// Captured before any test installs a fake clock, so the helpers below keep
// waiting in real time while the runtime's own timers are mocked.
const realSetTimeout = globalThis.setTimeout;

/**
 * Lets pending microtasks and I/O callbacks run without touching `setTimeout`,
 * which some of these tests replace with a fake clock.
 */
async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Waits for a condition the runtime reaches asynchronously (its startup reads the MCP config off disk). */
async function waitUntil(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 1000; i += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => realSetTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

class FakeConnection {
  userId: string | null = null;
  frames: AnyRecord[] = [];

  send(frame: AnyRecord): void {
    this.frames.push(frame);
  }

  setSessionId(): void {}

  kinds(): string[] {
    return this.frames.map((frame) => String(frame.kind));
  }
}

type FakeQuery = {
  options: AnyRecord;
  prompts: AnyRecord[];
  promptStreamClosed: boolean;
  emit(event: AnyRecord): Promise<void>;
  fail(error: Error): Promise<void>;
  interrupt(): Promise<void>;
  [Symbol.asyncIterator](): AsyncGenerator<AnyRecord>;
};

const queries: FakeQuery[] = [];
/** When set, the next `query()` call throws — the SDK rejecting the hook shapes. */
let rejectHooksOnce = false;

function createFakeQuery({ prompt, options }: { prompt: AsyncIterable<AnyRecord>; options: AnyRecord }): FakeQuery {
  if (rejectHooksOnce && options.hooks) {
    rejectHooksOnce = false;
    throw new Error('hooks are not supported by this SDK build');
  }

  const events: AnyRecord[] = [];
  let wake: (() => void) | null = null;
  let exited = false;
  let failure: Error | null = null;

  const resume = (): void => {
    const pending = wake;
    wake = null;
    pending?.();
  };

  const instance: FakeQuery = {
    options,
    prompts: [],
    promptStreamClosed: false,
    async emit(event) {
      events.push(event);
      resume();
      await flush();
    },
    async fail(error) {
      failure = error;
      resume();
      await flush();
    },
    async interrupt() {
      exited = true;
      resume();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (events.length > 0) {
          yield events.shift() as AnyRecord;
        }
        if (failure) {
          throw failure;
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

function createContext(): AnyRecord {
  return {
    resolveProviderSessionId: () => undefined,
    resolveResumeModel: async (_sessionId: string | undefined, model: string | undefined) => model,
    getProviderModels: async () => MODELS,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  };
}

const BASE_OPTIONS: AnyRecord = {
  model: 'default',
  images: [],
  files: [],
  toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: false },
};

function toolUse(name: string, input: AnyRecord): AnyRecord {
  return {
    type: 'assistant',
    session_id: 'provider-1',
    message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] },
  };
}

const RESULT: AnyRecord = { type: 'result', session_id: 'provider-1' };
const TASK_PROGRESS: AnyRecord = {
  type: 'system',
  subtype: 'task_progress',
  session_id: 'provider-1',
  task_id: 'task-1',
  description: 'still going',
};

const RUNNING_SUBAGENT = {
  id: 'a1',
  type: 'subagent',
  status: 'running',
  description: 'delegated work',
  agent_type: 'general-purpose',
};

/** Invokes a hook the runtime registered, the way the SDK's control channel does. */
async function fireHook(live: FakeQuery, event: 'Stop' | 'SubagentStop', payload: AnyRecord): Promise<void> {
  const matchers = live.options.hooks?.[event] as AnyRecord[] | undefined;
  const callback = matchers?.[0]?.hooks?.[0] as ((input: AnyRecord) => Promise<unknown>) | undefined;
  assert.ok(callback, `expected a registered ${event} hook`);
  await callback({ hook_event_name: event, session_id: 'provider-1', ...payload });
  await flush();
}

const CEILING_MS = 30 * 60 * 1000;

test('Claude background-work detection via the Stop-hook snapshot', async (t) => {
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
  // a user row and push channels; none of that is under test here.
  t.mock.module('@/modules/notifications/services/notification-orchestrator.service.js', {
    namedExports: {
      buildNotificationPayload: () => ({}),
      createNotificationEvent: (event: AnyRecord) => event,
      notifyUserIfEnabled: () => {},
      notifyRunStopped: () => {},
      notifyRunFailed: () => {},
      notifyPermissionResolved: () => {},
      notifyBackgroundWorkCompleted: () => {},
    },
  });

  const { queryClaudeSDK } = await import('@/modules/providers/list/claude/claude-runtime.provider.js');

  t.beforeEach(() => {
    queries.length = 0;
    rejectHooksOnce = false;
  });

  /** Starts a turn and waits for its query to exist. */
  async function startTurn(sessionId: string, options: AnyRecord = {}) {
    const connection = new FakeConnection();
    const before = queries.length;
    const turn = queryClaudeSDK('go', { ...BASE_OPTIONS, ...options, sessionId }, connection, createContext());
    await waitUntil(() => queries.length > before, `the query for ${sessionId} to start`);
    const live = queries.at(-1) as FakeQuery;
    assert.ok(live);
    return { connection, turn, live };
  }

  /**
   * Winds a held run down the way settled background work does, so no test
   * leaves a run parked on a stream nothing will ever close.
   */
  async function finishHeldTurn(live: FakeQuery, turn: Promise<void>): Promise<void> {
    if (live.options.hooks) {
      await fireHook(live, 'Stop', { background_tasks: [], session_crons: [] });
    }
    await live.emit(RESULT);
    await turn;
    assert.equal(live.promptStreamClosed, true, 'the hold ends once nothing is outstanding');
  }

  await t.test('a non-empty Stop snapshot holds the process open past the result', async () => {
    const { turn, live } = await startTurn('bg-held');

    // A plain subagent turn: nothing in the tool-name fallback would flag it.
    await live.emit(toolUse('Agent', { subagent_type: 'general-purpose', run_in_background: true }));
    await fireHook(live, 'Stop', { background_tasks: [RUNNING_SUBAGENT], session_crons: [] });
    await live.emit(RESULT);

    assert.equal(live.promptStreamClosed, false, 'the snapshot reported outstanding work, so stdin stays open');
    await finishHeldTurn(live, turn);
  });

  await t.test('a scheduled session cron also counts as outstanding work', async () => {
    const { turn, live } = await startTurn('bg-cron');

    await fireHook(live, 'Stop', {
      background_tasks: [],
      session_crons: [{ id: 'c1', schedule: '0 9 * * *', recurring: true, prompt: 'daily' }],
    });
    await live.emit(RESULT);

    assert.equal(live.promptStreamClosed, false, 'a cron will wake this session later');
    await finishHeldTurn(live, turn);
  });

  await t.test('an empty Stop snapshot releases the process as before', async () => {
    const { connection, turn, live } = await startTurn('bg-empty');

    // Even a subagent tool call releases when the snapshot says it already finished.
    await live.emit(toolUse('Agent', { subagent_type: 'general-purpose' }));
    await fireHook(live, 'Stop', { background_tasks: [], session_crons: [] });
    await live.emit(RESULT);
    await turn;

    assert.equal(live.promptStreamClosed, true, 'nothing outstanding, so stdin closes');
    assert.deepEqual(connection.kinds(), ['session_created', 'complete']);
  });

  await t.test('a turn with no background work at all still releases immediately', async () => {
    const { turn, live } = await startTurn('bg-plain');

    await live.emit(RESULT);
    await turn;

    assert.equal(live.promptStreamClosed, true);
  });

  await t.test('a SubagentStop snapshot is superseded by the turn-ending Stop snapshot', async () => {
    const { turn, live } = await startTurn('bg-subagent-stop');

    // SubagentStop lists the subagent that is stopping as still running, so
    // taking it as final would hold every subagent turn open.
    await fireHook(live, 'SubagentStop', { background_tasks: [RUNNING_SUBAGENT], session_crons: [] });
    await fireHook(live, 'Stop', { background_tasks: [], session_crons: [] });
    await live.emit(RESULT);
    await turn;

    assert.equal(live.promptStreamClosed, true, 'the last snapshot before the result decides');
  });

  await t.test('an SDK error mid-hold does not kill outstanding background work', async () => {
    const { connection, turn, live } = await startTurn('bg-error');

    await fireHook(live, 'Stop', { background_tasks: [RUNNING_SUBAGENT], session_crons: [] });
    await live.emit(RESULT);
    assert.equal(live.promptStreamClosed, false);

    await live.fail(new Error('socket hang up'));
    await turn;

    assert.equal(live.promptStreamClosed, false, 'a transient failure must not tear down the held process');
    assert.ok(connection.kinds().includes('error'), 'the failure still reaches the client');
  });

  await t.test('an SDK error before any Stop hook still protects a backgrounded Bash', async () => {
    // The hooks registered fine, but the run died before one could speak. With
    // no snapshot to override it the fallback signal is all there is, and
    // releasing here would kill a command that is still running.
    const { turn, live } = await startTurn('bg-error-pre-hook');

    await live.emit(toolUse('Bash', { command: 'sleep 100', run_in_background: true }));
    await live.fail(new Error('socket hang up'));
    await turn;

    assert.equal(live.promptStreamClosed, false);
  });

  await t.test('an SDK error mid-hold does not kill work the fallback is holding', async () => {
    // Without hooks the only signal is the backgrounded Bash, and the `result`
    // that started the hold has already consumed it — so the cleanup path has
    // to remember that this run is held, not just re-ask the ledger.
    rejectHooksOnce = true;
    const { live } = await startTurn('bg-error-fallback');

    await live.emit(toolUse('Bash', { command: 'sleep 100', run_in_background: true }));
    await live.emit(RESULT);
    assert.equal(live.promptStreamClosed, false);

    await live.fail(new Error('socket hang up'));
    await flush();

    assert.equal(live.promptStreamClosed, false, 'the held process survives the failure');
  });

  await t.test('an SDK error with nothing outstanding still releases the process', async () => {
    const { turn, live } = await startTurn('bg-error-clean');

    await live.fail(new Error('socket hang up'));
    await turn;

    assert.equal(live.promptStreamClosed, true);
  });

  await t.test('without hooks, only a backgrounded Bash holds the process', async () => {
    rejectHooksOnce = true;
    const { turn, live } = await startTurn('bg-fallback-bash');

    assert.equal(live.options.hooks, undefined, 'the retry carries no hooks');

    await live.emit(toolUse('Bash', { command: 'sleep 100', run_in_background: true }));
    await live.emit(RESULT);

    assert.equal(live.promptStreamClosed, false, 'the fallback still catches an explicitly backgrounded Bash');
    await finishHeldTurn(live, turn);
  });

  await t.test('without hooks, a subagent or a foreground Bash releases as usual', async () => {
    for (const [sessionId, block] of [
      ['bg-fallback-agent', toolUse('Agent', { subagent_type: 'general-purpose' })],
      ['bg-fallback-monitor', toolUse('Monitor', { command: 'watch' })],
      ['bg-fallback-fg-bash', toolUse('Bash', { command: 'ls' })],
    ] as Array<[string, AnyRecord]>) {
      rejectHooksOnce = true;
      const { turn, live } = await startTurn(sessionId);

      await live.emit(block);
      await live.emit(RESULT);
      await turn;

      assert.equal(live.promptStreamClosed, true, `${sessionId} must not be held by a tool name alone`);
    }
  });

  await t.test('the silence ceiling releases work that never reports back', async () => {
    const { turn, live } = await startTurn('bg-ceiling');

    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await fireHook(live, 'Stop', { background_tasks: [RUNNING_SUBAGENT], session_crons: [] });
      await live.emit(RESULT);
      assert.equal(live.promptStreamClosed, false);

      t.mock.timers.tick(CEILING_MS - 1);
      await flush();
      assert.equal(live.promptStreamClosed, false, 'the hold lasts the full ceiling');

      t.mock.timers.tick(2);
      await flush();
      assert.equal(live.promptStreamClosed, true, 'the ceiling is a backstop for work that never reports');
    } finally {
      t.mock.timers.reset();
    }
    await turn;
  });

  await t.test('a task_progress event pushes the silence ceiling back out', async () => {
    const { turn, live } = await startTurn('bg-progress');

    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await fireHook(live, 'Stop', { background_tasks: [RUNNING_SUBAGENT], session_crons: [] });
      await live.emit(RESULT);

      t.mock.timers.tick(CEILING_MS - 1000);
      await flush();
      await live.emit(TASK_PROGRESS);

      t.mock.timers.tick(2000);
      await flush();
      assert.equal(live.promptStreamClosed, false, 'the progress report re-armed the countdown');

      t.mock.timers.tick(CEILING_MS);
      await flush();
      assert.equal(live.promptStreamClosed, true);
    } finally {
      t.mock.timers.reset();
    }
    await turn;
  });
});
