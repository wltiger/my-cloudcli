import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AnyRecord, ProviderModelsDefinition } from '@/shared/types.js';

// The runtime is imported dynamically inside the test, after the module mocks
// are installed: a static import here would cache the real Claude Agent SDK
// before it could be replaced.

/** Subscription models only — every option resolves to the logged-in account. */
const MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'default', label: 'Default', effort: { values: [{ value: 'high' }] } },
    { value: 'opus', label: 'Opus' },
  ],
  DEFAULT: 'default',
};

/** Adds two custom endpoints that share a base URL but not an API key. */
const ENDPOINT_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    ...MODELS.OPTIONS,
    { value: 'proxy-a', label: 'Proxy A', baseUrl: 'https://proxy.test', apiKey: 'key-a' },
    { value: 'proxy-b', label: 'Proxy B', baseUrl: 'https://proxy.test', apiKey: 'key-b' },
  ],
  DEFAULT: 'default',
};

/**
 * Adds two endpoint-less custom models whose only difference is the context
 * window they declare, so reuse can only be refused on the window itself.
 */
const WINDOW_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    ...MODELS.OPTIONS,
    { value: 'window-256k', label: 'Window 256K', isCustom: true, contextWindow: 262_144 },
    { value: 'window-128k', label: 'Window 128K', isCustom: true, contextWindow: 131_072 },
  ],
  DEFAULT: 'default',
};

/** Lets pending microtasks and I/O callbacks run before asserting. */
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
    await new Promise((resolve) => setTimeout(resolve, 5));
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
}

type FakeQuery = {
  options: AnyRecord;
  prompts: AnyRecord[];
  promptStreamClosed: boolean;
  /** In-flight settings changes the runtime applied to this live query. */
  modelChanges: Array<string | undefined>;
  permissionModeChanges: string[];
  mcpServerChanges: AnyRecord[];
  flagSettingsChanges: AnyRecord[];
  emit(event: AnyRecord): Promise<void>;
  interrupt(): Promise<void>;
  setModel(model?: string): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  setMcpServers(servers: AnyRecord): Promise<AnyRecord>;
  applyFlagSettings(settings: AnyRecord): Promise<void>;
  [Symbol.asyncIterator](): AsyncGenerator<AnyRecord>;
};

const queries: FakeQuery[] = [];
/** When set, the next in-flight setter call rejects, as a dead process would. */
let failNextSetter = false;

function createFakeQuery({ prompt, options }: { prompt: AsyncIterable<AnyRecord>; options: AnyRecord }): FakeQuery {
  const events: AnyRecord[] = [];
  let wake: (() => void) | null = null;
  let exited = false;

  const resume = (): void => {
    const pending = wake;
    wake = null;
    pending?.();
  };

  const refuseWhenAsked = (): void => {
    if (failNextSetter) {
      failNextSetter = false;
      throw new Error('control request failed');
    }
  };

  const instance: FakeQuery = {
    options,
    prompts: [],
    promptStreamClosed: false,
    modelChanges: [],
    permissionModeChanges: [],
    mcpServerChanges: [],
    flagSettingsChanges: [],
    async emit(event) {
      events.push(event);
      resume();
      await flush();
    },
    async interrupt() {
      exited = true;
      resume();
    },
    async setModel(model) {
      refuseWhenAsked();
      instance.modelChanges.push(model);
    },
    async setPermissionMode(mode) {
      refuseWhenAsked();
      instance.permissionModeChanges.push(mode);
    },
    async setMcpServers(servers) {
      refuseWhenAsked();
      instance.mcpServerChanges.push(servers);
      return {};
    },
    async applyFlagSettings(settings) {
      refuseWhenAsked();
      instance.flagSettingsChanges.push(settings);
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

function createContext(models: ProviderModelsDefinition = MODELS): AnyRecord {
  return {
    resolveProviderSessionId: () => undefined,
    resolveResumeModel: async (_sessionId: string | undefined, model: string | undefined) => model,
    getProviderModels: async () => models,
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

const RESULT: AnyRecord = { type: 'result', session_id: 'provider-1' };

/** A turn that leaves a shell running, so its process is held open afterwards. */
const BACKGROUND_BASH: AnyRecord = {
  type: 'assistant',
  session_id: 'provider-1',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', name: 'Bash', input: { command: 'sleep 100', run_in_background: true } }],
  },
};

/** Invokes a hook the runtime registered, the way the SDK's control channel does. */
async function fireHook(live: FakeQuery, event: 'Stop', payload: AnyRecord): Promise<void> {
  const matchers = live.options.hooks?.[event] as AnyRecord[] | undefined;
  const callback = matchers?.[0]?.hooks?.[0] as ((input: AnyRecord) => Promise<unknown>) | undefined;
  assert.ok(callback, `expected a registered ${event} hook`);
  await callback({ hook_event_name: event, session_id: 'provider-1', ...payload });
  await flush();
}

/** Calls the runtime's own tool-use gate the way the SDK does. */
function askGate(live: FakeQuery, toolName: string, input: AnyRecord): Promise<AnyRecord> {
  const canUseTool = live.options.canUseTool as (
    tool: string,
    toolInput: AnyRecord,
    context: AnyRecord,
  ) => Promise<AnyRecord>;
  assert.ok(canUseTool, 'expected the runtime to install a tool-use gate');
  return canUseTool(toolName, input, {});
}

test('Claude per-turn process-reuse compatibility', async (t) => {
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
  // barrel's other exports keep working for its other importers.
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

  const { queryClaudeSDK, resolveToolApproval } =
    await import('@/modules/providers/list/claude/claude-runtime.provider.js');

  // Both the MCP config and (on the reuse path) the turn's attachments are read
  // off disk, so the whole file runs against a temporary home and workspace.
  // Canonicalized because the attachment trust boundary compares real paths, and
  // Windows hands out a short 8.3 temp directory that never matches one.
  const workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'claude-compat-')));
  const home = path.join(workspace, 'home');
  const previousHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  await writeMcpConfig({});

  t.after(async () => {
    process.env.HOME = previousHome.HOME;
    process.env.USERPROFILE = previousHome.USERPROFILE;
    await rm(workspace, { recursive: true, force: true });
  });

  t.beforeEach(() => {
    queries.length = 0;
    failNextSetter = false;
  });

  /** Rewrites the MCP config the runtime loads at the start of every turn. */
  async function writeMcpConfig(mcpServers: AnyRecord): Promise<void> {
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, '.claude.json'), JSON.stringify({ mcpServers }), 'utf8');
  }

  /** Starts a turn and waits for either a pushed prompt or a new query. */
  async function startTurn(
    sessionId: string,
    options: AnyRecord = {},
    command = 'go',
    models: ProviderModelsDefinition = MODELS,
  ) {
    const connection = new FakeConnection();
    const queriesBefore = queries.length;
    const promptsBefore = queries.at(-1)?.prompts.length ?? 0;
    const turn = queryClaudeSDK(
      command,
      { ...BASE_OPTIONS, cwd: workspace, ...options, sessionId },
      connection,
      createContext(models),
    );
    await waitUntil(
      () => queries.length > queriesBefore || (queries.at(-1)?.prompts.length ?? 0) > promptsBefore,
      `the turn for ${sessionId} to reach a process`,
    );
    await flush();
    return { connection, turn, live: queries.at(-1) as FakeQuery };
  }

  /**
   * Runs a first turn that leaves a background shell behind, so its process is
   * parked and available for the follow-up each test actually cares about.
   */
  async function startHeldTurn(
    sessionId: string,
    options: AnyRecord = {},
    models: ProviderModelsDefinition = MODELS,
  ) {
    const started = await startTurn(sessionId, options, 'first question', models);
    await started.live.emit(BACKGROUND_BASH);
    await started.live.emit(RESULT);
    assert.equal(started.live.promptStreamClosed, false, 'the first turn holds its process for the shell');
    return started;
  }

  /** Winds a held run down the way settled background work does. */
  async function releaseHeldRun(live: FakeQuery, turn: Promise<unknown>): Promise<void> {
    await fireHook(live, 'Stop', { background_tasks: [], session_crons: [] });
    await live.emit(RESULT);
    await turn;
    assert.equal(live.promptStreamClosed, true, 'the hold ends once nothing is outstanding');
  }

  await t.test('a model change within the same endpoint is applied in flight', async () => {
    const first = await startHeldTurn('compat-model');
    const second = await startTurn('compat-model', { model: 'opus' }, 'second question');

    assert.equal(queries.length, 1, 'a model change alone does not need a new process');
    assert.equal(first.live.prompts.length, 2, 'the follow-up reached the held input stream');
    assert.deepEqual(first.live.modelChanges, ['opus'], 'the live query was switched to the new model');

    await first.live.emit(RESULT);
    await second.turn;
    await releaseHeldRun(first.live, first.turn);
  });

  await t.test('a model on a custom endpoint needs a new process', async () => {
    const first = await startHeldTurn('compat-endpoint', {}, ENDPOINT_MODELS);
    const second = await startTurn('compat-endpoint', { model: 'proxy-a' }, 'second', ENDPOINT_MODELS);

    assert.equal(queries.length, 2, 'the endpoint is baked into the process environment');
    assert.equal(first.live.promptStreamClosed, true, 'the previous hold is released');
    assert.deepEqual(first.live.modelChanges, [], 'nothing was renegotiated on the abandoned process');

    await queries[1]?.emit(RESULT);
    await Promise.all([first.turn, second.turn]);
  });

  await t.test('two custom endpoints do not share a process', async () => {
    const first = await startHeldTurn('compat-two-endpoints', { model: 'proxy-a' }, ENDPOINT_MODELS);
    const second = await startTurn('compat-two-endpoints', { model: 'proxy-b' }, 'second', ENDPOINT_MODELS);

    assert.equal(queries.length, 2, 'a shared base URL with a different key is still a different endpoint');

    await queries[1]?.emit(RESULT);
    await Promise.all([first.turn, second.turn]);
  });

  await t.test('a declared context window needs a new process', async () => {
    // The window is baked into the child process's environment at spawn time,
    // so a built-in model's held process can never serve a declared one.
    const first = await startHeldTurn('compat-window', {}, WINDOW_MODELS);
    const second = await startTurn('compat-window', { model: 'window-256k' }, 'second', WINDOW_MODELS);

    assert.equal(queries.length, 2, 'the declared window is baked into the process environment');
    assert.equal(first.live.promptStreamClosed, true, 'the previous hold is released');
    assert.deepEqual(first.live.modelChanges, [], 'nothing was renegotiated on the abandoned process');

    await queries[1]?.emit(RESULT);
    await Promise.all([first.turn, second.turn]);
  });

  await t.test('two declared context windows do not share a process', async () => {
    const first = await startHeldTurn('compat-two-windows', { model: 'window-256k' }, WINDOW_MODELS);
    const second = await startTurn('compat-two-windows', { model: 'window-128k' }, 'second', WINDOW_MODELS);

    assert.equal(queries.length, 2, 'models that differ only by declared window are different processes');

    await queries[1]?.emit(RESULT);
    await Promise.all([first.turn, second.turn]);
  });

  await t.test('a tightened permission mode is enforced on the very next tool use', async () => {
    const first = await startHeldTurn('compat-permission', {
      toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: true },
    });

    assert.deepEqual(
      await askGate(first.live, 'Bash', { command: 'ls' }),
      { behavior: 'allow', updatedInput: { command: 'ls' } },
      'bypass mode auto-allows while it is in force',
    );

    const second = await startTurn(
      'compat-permission',
      { toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: false } },
      'second question',
    );

    assert.equal(queries.length, 1, 'a permission-mode change alone does not need a new process');
    assert.deepEqual(first.live.permissionModeChanges, ['default'], 'the SDK was told about the new mode');

    // The security-relevant half: the runtime's own gate must not keep
    // auto-allowing under the mode the process was constructed with.
    const gated = askGate(first.live, 'Bash', { command: 'rm -rf /' });
    await flush();
    const request = second.connection.frames.find((frame) => frame.kind === 'permission_request');
    assert.ok(request, 'the tightened mode sends the tool use to the user instead of allowing it');
    resolveToolApproval(String(request.requestId), { allow: false });
    assert.equal((await gated).behavior, 'deny');

    await first.live.emit(RESULT);
    await second.turn;
    await releaseHeldRun(first.live, first.turn);
  });

  await t.test('changed tool rules are enforced on the next tool use', async () => {
    const first = await startHeldTurn('compat-tools', {
      toolsSettings: { allowedTools: ['Bash'], disallowedTools: [], skipPermissions: false },
    });

    assert.equal((await askGate(first.live, 'Bash', { command: 'ls' })).behavior, 'allow');

    const second = await startTurn(
      'compat-tools',
      { toolsSettings: { allowedTools: [], disallowedTools: ['Bash'], skipPermissions: false } },
      'second question',
    );

    assert.equal(queries.length, 1, 'a tools-settings change alone does not need a new process');
    assert.deepEqual(await askGate(first.live, 'Bash', { command: 'ls' }), {
      behavior: 'deny',
      message: 'Tool disallowed by settings',
    });
    // The CLI judges the tool lists the process was spawned with before it ever
    // asks this runtime, so the new rules have to reach it too.
    assert.deepEqual(first.live.flagSettingsChanges, [
      { permissions: { allow: [], deny: ['Bash'] } },
    ]);

    await first.live.emit(RESULT);
    await second.turn;
    await releaseHeldRun(first.live, first.turn);
  });

  await t.test('an MCP server change is applied in flight', async () => {
    await writeMcpConfig({ alpha: { command: 'alpha-server' } });
    const first = await startHeldTurn('compat-mcp');
    assert.deepEqual(first.live.options.mcpServers, { alpha: { command: 'alpha-server' } });

    await writeMcpConfig({ alpha: { command: 'alpha-server' }, beta: { command: 'beta-server' } });
    const second = await startTurn('compat-mcp', {}, 'second question');

    assert.equal(queries.length, 1, 'MCP servers are renegotiated, not respawned');
    assert.deepEqual(first.live.mcpServerChanges, [
      { alpha: { command: 'alpha-server' }, beta: { command: 'beta-server' } },
    ]);

    await first.live.emit(RESULT);
    await second.turn;
    await releaseHeldRun(first.live, first.turn);
    await writeMcpConfig({});
  });

  await t.test('an unchanged follow-up renegotiates nothing', async () => {
    const first = await startHeldTurn('compat-unchanged');
    const second = await startTurn('compat-unchanged', {}, 'second question');

    assert.equal(queries.length, 1);
    assert.deepEqual(first.live.modelChanges, []);
    assert.deepEqual(first.live.permissionModeChanges, []);
    assert.deepEqual(first.live.mcpServerChanges, []);
    assert.deepEqual(first.live.flagSettingsChanges, []);

    await first.live.emit(RESULT);
    await second.turn;
    await releaseHeldRun(first.live, first.turn);
  });

  await t.test('attachments do not need a new process', async () => {
    const first = await startHeldTurn('compat-attachments');

    const imagePath = path.join(workspace, 'shot.png');
    await writeFile(imagePath, Buffer.from('89504e470d0a1a0a', 'hex'));
    const second = await startTurn(
      'compat-attachments',
      { images: [{ path: imagePath, mimeType: 'image/png' }], files: [{ path: 'notes.md' }] },
      'what is this',
    );

    assert.equal(queries.length, 1, 'message content shape is not a process setting');
    const pushed = first.live.prompts[1] as AnyRecord;
    assert.ok(
      (pushed?.message?.content as AnyRecord[])?.some((block) => block.type === 'image'),
      'the image rode into the held stream as a content block',
    );
    assert.match(JSON.stringify(pushed), /notes\.md/);

    await first.live.emit(RESULT);
    await second.turn;
    await releaseHeldRun(first.live, first.turn);
  });

  await t.test('an effort change needs a new process', async () => {
    const first = await startHeldTurn('compat-effort');
    const second = await startTurn('compat-effort', { effort: 'high' }, 'second question');

    assert.equal(queries.length, 2, 'effort has no in-flight equivalent');
    assert.equal(first.live.promptStreamClosed, true);

    await queries[1]?.emit(RESULT);
    await Promise.all([first.turn, second.turn]);
  });

  await t.test('a working-directory change needs a new process', async () => {
    const first = await startHeldTurn('compat-cwd');
    const second = await startTurn('compat-cwd', { cwd: path.join(workspace, 'elsewhere') }, 'second question');

    assert.equal(queries.length, 2, 'the working directory is fixed at spawn time');

    await queries[1]?.emit(RESULT);
    await Promise.all([first.turn, second.turn]);
  });

  await t.test('an edit carrying a resume anchor needs a new process', async () => {
    const first = await startHeldTurn('compat-anchor');
    const second = await startTurn('compat-anchor', { resumeAnchorId: 'row-9' }, 'edited question');

    assert.equal(queries.length, 2, 'a live process cannot rewind to an earlier anchor');

    await queries[1]?.emit(RESULT);
    await Promise.all([first.turn, second.turn]);
  });

  await t.test('an edit of the first message needs a new process', async () => {
    const first = await startHeldTurn('compat-scratch');
    const second = await startTurn('compat-scratch', { resumeFromScratch: true }, 'edited question');

    assert.equal(queries.length, 2, 'starting the conversation over cannot happen in flight');

    await queries[1]?.emit(RESULT);
    await Promise.all([first.turn, second.turn]);
  });

  await t.test('a refused in-flight change falls back to a new process', async () => {
    const first = await startHeldTurn('compat-refused', {
      toolsSettings: { allowedTools: [], disallowedTools: ['Bash'], skipPermissions: false },
    });
    failNextSetter = true;
    const second = await startTurn(
      'compat-refused',
      { toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: true } },
      'second question',
    );

    assert.equal(queries.length, 2, 'a live query that cannot adopt the new settings is not reused');
    assert.equal(first.live.promptStreamClosed, true, 'the process that refused is let go');
    // Releasing is not instant, and a turn this process never took must not
    // loosen what its own outstanding work is judged by in the meantime.
    assert.deepEqual(await askGate(first.live, 'Bash', { command: 'ls' }), {
      behavior: 'deny',
      message: 'Tool disallowed by settings',
    });

    await queries[1]?.emit(RESULT);
    await Promise.all([first.turn, second.turn]);
  });
});
