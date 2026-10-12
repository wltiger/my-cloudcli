import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBackgroundWorkTracker,
  queryClaudeSDK,
  startsBackgroundWork,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { AnyRecord, ProviderModelsDefinition } from '@/shared/types.js';

// Only turns that start work outliving the turn hold their CLI process open. A
// turn scored `false` here has its stdin released the moment `result` arrives,
// and the CLI reads that EOF as print wind-down — so anything still running dies.
const turn = (...blocks: Array<{ name: string; input?: Record<string, unknown> }>) => ({
  type: 'assistant',
  message: { content: blocks.map((block) => ({ type: 'tool_use', input: {}, ...block })) },
});

test('a backgrounded Bash holds the process open', () => {
  assert.equal(startsBackgroundWork(turn({ name: 'Bash', input: { run_in_background: true } })), true);
});

test('a foreground Bash does not', () => {
  assert.equal(startsBackgroundWork(turn({ name: 'Bash', input: { run_in_background: false } })), false);
});

test('a backgrounded Agent holds the process open', () => {
  // The gap this suite exists for: a background agent used to be scored as
  // nothing outstanding, so the CLI wound down and killed it mid-run.
  assert.equal(startsBackgroundWork(turn({ name: 'Agent', input: { run_in_background: true } })), true);
});

test('an Agent with no run_in_background holds the process open', () => {
  // `run_in_background` is optional on AgentInput and agents background by
  // default, so an omitted field means background, not foreground.
  assert.equal(startsBackgroundWork(turn({ name: 'Agent', input: { prompt: 'Investigate' } })), true);
});

test('a foreground Agent does not', () => {
  // It never pushes a follow-up turn, so holding for it would pin the process
  // for the full BG_WAIT_CEILING_MS.
  assert.equal(startsBackgroundWork(turn({ name: 'Agent', input: { run_in_background: false } })), false);
});

test('a Workflow holds the process open', () => {
  // WorkflowInput has no foreground option: every call returns a task id
  // immediately and reports back in a later turn.
  assert.equal(startsBackgroundWork(turn({ name: 'Workflow', input: { script: 'export const meta = {}' } })), true);
});

test('a deferred-work tool holds the process open', () => {
  assert.equal(startsBackgroundWork(turn({ name: 'Monitor' })), true);
});

test('a turn that starts nothing lasting does not', () => {
  assert.equal(startsBackgroundWork(turn({ name: 'Read' })), false);
});

test('one backgrounded agent among foreground calls is enough', () => {
  assert.equal(
    startsBackgroundWork(
      turn(
        { name: 'Read' },
        { name: 'Agent', input: { run_in_background: false } },
        { name: 'Agent', input: { run_in_background: true } },
      ),
    ),
    true,
  );
});

test('a message carrying no tool calls does not', () => {
  assert.equal(startsBackgroundWork({ type: 'result', message: { content: 'done' } }), false);
  assert.equal(startsBackgroundWork({ type: 'assistant', message: { content: [] } }), false);
  assert.equal(startsBackgroundWork({}), false);
});

// Once the turn's `result` is out, the tracker below is the only record of
// what the held process is still running: the running-sessions list reads it
// and a stop request is refused unless it names one of its tasks. The event
// shapes are the SDK's own, as a real query emits them.
const started = (taskId: string, extra: Record<string, unknown> = {}) => ({
  type: 'system',
  subtype: 'task_started',
  task_id: taskId,
  tool_use_id: `toolu_${taskId}`,
  description: `Task ${taskId}`,
  task_type: 'local_agent',
  ...extra,
});
const notified = (taskId: string, status: string) => ({
  type: 'system', subtype: 'task_notification', task_id: taskId, tool_use_id: `toolu_${taskId}`, status, summary: '', output_file: '',
});
const updated = (taskId: string, patch: Record<string, unknown>) => ({
  type: 'system', subtype: 'task_updated', task_id: taskId, patch,
});

test('a task_started with a tool_use_id adds the task under its session', () => {
  const tracker = createBackgroundWorkTracker();
  const before = Date.now();
  // The session's own turn issued the call, so the task is its own work.
  tracker.apply('s1', {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Workflow', input: {} }] },
  });
  tracker.apply('s1', started('t1', { task_type: 'local_workflow', workflow_name: 'spec' }));

  const [entry] = tracker.list();
  assert.equal(tracker.list().length, 1);
  assert.equal(entry.sessionId, 's1');
  assert.equal(entry.tasks.length, 1);
  const { startedAt, ...task } = entry.tasks[0];
  assert.deepEqual(task, {
    taskId: 't1',
    toolUseId: 'toolu_t1',
    taskType: 'local_workflow',
    description: 'Task t1',
    workflowName: 'spec',
  });
  assert.ok(startedAt >= before && startedAt <= Date.now());
  assert.equal(tracker.hasOutstanding('s1'), true);
  assert.equal(tracker.has('s1', 't1'), true);
});

test('a task started for a call the session itself made is its own; one from inside an agent is nested', () => {
  // Verified on a real run: a workflow agent that backgrounds `sleep 60` puts
  // a `task_started` on the parent's stream, with a tool_use_id from the
  // agent's transcript. The parent transcript has no card for it, and the
  // pill would otherwise read "3 tasks" for one workflow.
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Workflow', input: {} }] },
  });
  tracker.apply('s1', started('t1', { task_type: 'local_workflow', workflow_name: 'spec' }));
  tracker.apply('s1', started('t2', { task_type: 'local_bash', description: 'Sleep for 60 seconds' }));

  const [entry] = tracker.list();
  assert.deepEqual(entry.tasks.map((task) => [task.taskId, task.nested ?? false]), [['t1', false], ['t2', true]]);
  assert.equal(tracker.has('s1', 't2'), true, 'a nested task can still be stopped');

  // The set of own calls dies with the session, like the tasks.
  tracker.clear('s1');
  tracker.apply('s1', started('t1', { task_type: 'local_workflow' }));
  assert.equal(tracker.list()[0].tasks[0].nested, true);
});

test('a task_started without a tool_use_id is not tracked', () => {
  // Housekeeping tasks the CLI starts on its own have no launching call and
  // nothing in the transcript to show them under.
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', { type: 'system', subtype: 'task_started', task_id: 'ambient', description: 'x' });

  assert.deepEqual(tracker.list(), []);
  assert.equal(tracker.hasOutstanding('s1'), false);
});

test('a task_notification removes the task whatever its status', () => {
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', started('t1'));
  tracker.apply('s1', started('t2'));
  tracker.apply('s1', notified('t1', 'completed'));

  assert.equal(tracker.has('s1', 't1'), false);
  assert.equal(tracker.has('s1', 't2'), true);
  assert.equal(tracker.hasOutstanding('s1'), true);

  tracker.apply('s1', notified('t2', 'stopped'));
  assert.equal(tracker.hasOutstanding('s1'), false);
  assert.deepEqual(tracker.list(), []);
});

test('a terminal task_updated removes the task', () => {
  const tracker = createBackgroundWorkTracker();
  for (const [taskId, status] of [['a', 'completed'], ['b', 'failed'], ['c', 'killed']]) {
    tracker.apply('s1', started(taskId));
    tracker.apply('s1', updated(taskId, { status, end_time: 1 }));
    assert.equal(tracker.has('s1', taskId), false, `${status} settles the task`);
  }
  assert.equal(tracker.hasOutstanding('s1'), false);
});

test('a non-terminal task_updated keeps the task', () => {
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', started('t1'));
  tracker.apply('s1', updated('t1', { status: 'running' }));
  tracker.apply('s1', updated('t1', { is_backgrounded: true }));
  tracker.apply('s1', updated('t1', { status: 'paused' }));

  assert.equal(tracker.has('s1', 't1'), true);
  assert.equal(tracker.hasOutstanding('s1'), true);
});

test('clearing a session empties it and leaves the others alone', () => {
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', started('t1'));
  tracker.apply('s2', started('t2'));
  tracker.clear('s1');

  assert.equal(tracker.hasOutstanding('s1'), false);
  assert.equal(tracker.has('s1', 't1'), false);
  assert.deepEqual(tracker.list().map((entry) => entry.sessionId), ['s2']);
});

test('messages that are not task events leave the set untouched', () => {
  const tracker = createBackgroundWorkTracker();
  tracker.apply('s1', started('t1'));
  tracker.apply('s1', { type: 'assistant', message: { content: [] } });
  tracker.apply('s1', { type: 'system', subtype: 'task_progress', task_id: 't1', description: 'x', usage: {} });
  tracker.apply('s1', { type: 'result', task_id: 't1' });

  assert.equal(tracker.has('s1', 't1'), true);
});

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
    createQuery: createFakeQuery,
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

// The Stop-hook snapshot is this fork's third hold signal, next to the task
// tracker and `startsBackgroundWork` above: the only one that sees a cron set up
// in an earlier turn. These drive whole runs through `context.createQuery`.
test('Claude background-work detection via the Stop-hook snapshot', async (t) => {
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
    await live.emit(toolUse('Agent', { subagent_type: 'general-purpose', run_in_background: false }));
    await fireHook(live, 'Stop', { background_tasks: [], session_crons: [] });
    await live.emit(RESULT);
    await turn;

    assert.equal(live.promptStreamClosed, true, 'nothing outstanding, so stdin closes');
    assert.deepEqual(connection.kinds(), ['session_created', 'complete']);
  });

  await t.test('an empty Stop snapshot cannot override a background start observed this turn', async () => {
    // The CLI can take the snapshot before it has registered the task the turn
    // just backgrounded — the reading is empty while the work is live. Trusting
    // it is what let a freshly backgrounded shell be swept on wind-down.
    const { turn, live } = await startTurn('bg-race-bash');

    await live.emit(toolUse('Bash', { command: 'sleep 100', run_in_background: true }));
    await fireHook(live, 'Stop', { background_tasks: [], session_crons: [] });
    await live.emit(RESULT);

    assert.equal(live.promptStreamClosed, false, 'the observed start outranks the stale empty reading');
    await finishHeldTurn(live, turn);
  });

  await t.test('an empty Stop snapshot still holds a subagent this turn backgrounded', async () => {
    const { turn, live } = await startTurn('bg-race-agent');

    await live.emit(toolUse('Agent', { subagent_type: 'general-purpose', run_in_background: true }));
    await fireHook(live, 'Stop', { background_tasks: [], session_crons: [] });
    await live.emit(RESULT);

    assert.equal(live.promptStreamClosed, false, 'a backgrounded subagent holds even on an empty snapshot');
    await finishHeldTurn(live, turn);
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

  await t.test('a stopped task leaves the snapshot, so stopping the last one releases the process', async () => {
    // A stopped task never fires another Stop hook — only its `stopped`
    // notification — so a snapshot that kept listing it would hold the process
    // until the ceiling.
    const { turn, live } = await startTurn('bg-stopped');

    await fireHook(live, 'Stop', { background_tasks: [RUNNING_SUBAGENT], session_crons: [] });
    await live.emit(RESULT);
    assert.equal(live.promptStreamClosed, false);

    await live.emit({ type: 'system', subtype: 'task_notification', session_id: 'provider-1', task_id: 'a1', status: 'stopped' });
    await turn;
    assert.equal(live.promptStreamClosed, true, 'nothing is left in the snapshot once its task is stopped');
  });

  await t.test('a cron keeps the process held after its last task is stopped', async () => {
    const { turn, live } = await startTurn('bg-stopped-cron');

    await fireHook(live, 'Stop', {
      background_tasks: [RUNNING_SUBAGENT],
      session_crons: [{ id: 'c1', schedule: '0 9 * * *', recurring: true, prompt: 'daily' }],
    });
    await live.emit(RESULT);
    await live.emit({ type: 'system', subtype: 'task_notification', session_id: 'provider-1', task_id: 'a1', status: 'stopped' });

    assert.equal(live.promptStreamClosed, false, 'the cron will still wake this session');
    await finishHeldTurn(live, turn);
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
    // The hooks registered fine, but the run died before one could speak, so no
    // snapshot exists to hold on. The *observed start* (`backgroundWorkPending`)
    // is all there is, and the cleanup path has to consult it — releasing here
    // would kill a command that is still running, which is exactly the failure
    // the `finally` guard exists to prevent.
    const { live } = await startTurn('bg-error-pre-hook');

    await live.emit(toolUse('Bash', { command: 'sleep 100', run_in_background: true }));
    await live.fail(new Error('socket hang up'));
    await flush();

    assert.equal(live.promptStreamClosed, false, 'the observed start must keep stdin open through the failure');
  });

  await t.test('an SDK error mid-hold does not kill work the fallback is holding', async () => {
    // Without hooks the only signal is the backgrounded Bash, and the `result`
    // that started the hold has already consumed it — so the cleanup path has
    // to remember that this run is held, not just re-ask the tracker.
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

  await t.test('an SDK error after a foreground tool still releases the process', async () => {
    // The mirror of the observed-start case above, and the one that keeps that
    // guard honest: a tool that plainly does *not* outlive the turn must not
    // hold the process open when the run dies. A foreground Agent opts out with
    // `run_in_background: false`, so neither `startsBackgroundWork` nor the
    // tracker has anything to report — the failure still releases.
    const { turn, live } = await startTurn('bg-error-foreground');

    await live.emit(toolUse('Agent', { subagent_type: 'general-purpose', run_in_background: false }));
    await live.fail(new Error('socket hang up'));
    await turn;

    assert.equal(live.promptStreamClosed, true, 'a foreground tool must not hold the process through a failure');
  });

  await t.test('without hooks, an explicitly backgrounded Bash holds the process', async () => {
    rejectHooksOnce = true;
    const { turn, live } = await startTurn('bg-fallback-bash');

    assert.equal(live.options.hooks, undefined, 'the retry carries no hooks');

    await live.emit(toolUse('Bash', { command: 'sleep 100', run_in_background: true }));
    await live.emit(RESULT);

    assert.equal(live.promptStreamClosed, false, 'the fallback still catches an explicitly backgrounded Bash');
    await finishHeldTurn(live, turn);
  });

  await t.test('without hooks, a backgrounded subagent holds the process', async () => {
    for (const [sessionId, block] of [
      ['bg-fallback-agent-bg', toolUse('Agent', { subagent_type: 'general-purpose', run_in_background: true })],
    ] as Array<[string, AnyRecord]>) {
      rejectHooksOnce = true;
      const { turn, live } = await startTurn(sessionId);

      await live.emit(block);
      await live.emit(RESULT);

      assert.equal(live.promptStreamClosed, false, `${sessionId} holds on the observed background start`);
      await finishHeldTurn(live, turn);
    }
  });

  await t.test('without hooks, a foreground subagent or a foreground Bash releases as usual', async () => {
    for (const [sessionId, block] of [
      ['bg-fallback-agent', toolUse('Agent', { subagent_type: 'general-purpose', run_in_background: false })],
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
