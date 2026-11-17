import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ProviderModelsDefinition } from '@/shared/types.js';

// Multi-line on purpose: the text must reach the SDK untouched.
const CUSTOM_SYSTEM_PROMPT = 'You are a terse relay assistant.\n\nAnswer in one line.';

const DEFAULT_SYSTEM_PROMPT = { type: 'preset', preset: 'claude_code' };

const CUSTOM_ENDPOINT_CATALOG: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'default', label: 'Default' },
    { value: 'plain-model', label: 'Plain custom model', isCustom: true },
    {
      value: 'local-model',
      label: 'My Local Model',
      isCustom: true,
      baseUrl: 'http://localhost:11434',
      apiKey: 'sk-local-123',
    },
    {
      value: 'local-model-with-effort',
      label: 'My Local Model (custom effort)',
      isCustom: true,
      baseUrl: 'http://localhost:11434',
      apiKey: 'sk-local-123',
      effort: { default: 'medium', values: [{ value: 'low' }, { value: 'medium' }, { value: 'xhigh' }] },
    },
    {
      value: 'window-model',
      label: 'My Local Model (declared window)',
      isCustom: true,
      baseUrl: 'http://localhost:11434',
      apiKey: 'sk-local-123',
      contextWindow: 262_144,
    },
    {
      value: 'window-only-model',
      label: 'Declared window, no endpoint',
      isCustom: true,
      contextWindow: 262_144,
    },
    {
      value: 'agent-model',
      label: 'Endpoint model with an agent prompt',
      isCustom: true,
      baseUrl: 'http://localhost:11434',
      apiKey: 'sk-local-123',
      systemPromptAgent: 'relay-agent',
    },
    { value: 'ghost-agent-model', label: 'Agent with no file', isCustom: true, systemPromptAgent: 'ghost-agent' },
    { value: 'empty-agent-model', label: 'Agent with an empty body', isCustom: true, systemPromptAgent: 'empty-agent' },
    {
      value: 'prompt-model',
      label: 'Endpoint model with its own prompt',
      isCustom: true,
      baseUrl: 'http://localhost:11434',
      apiKey: 'sk-local-123',
      systemPrompt: CUSTOM_SYSTEM_PROMPT,
    },
  ],
  DEFAULT: 'default',
};

type FakeQueryCall = { prompt: unknown; options: Record<string, any> };

const createFakeWs = () => ({
  userId: null as string | null,
  frames: [] as Record<string, any>[],
  send(frame: Record<string, any>) {
    this.frames.push(frame);
  },
  setSessionId: () => {},
});

/** Stream the next `query()` call replays, so a turn can end on a real result. */
let queuedMessages: Record<string, any>[] = [];
/** When set, the next `query()` call's stream throws it, as a CLI that exited early does. */
let queuedStreamError: Error | null = null;

const createFakeContext = (
  modelsDefinition: ProviderModelsDefinition,
  resolveProviderSessionId: (sessionId?: string) => string | null = () => null,
) => ({
  resolveProviderSessionId,
  resolveResumeModel: async (_sessionId: string | undefined, model: string | undefined) => model,
  getProviderModels: async () => modelsDefinition,
  normalizeMessage: () => [],
  isProviderInstalled: async () => true,
});

test('Claude runtime environment overrides', async (t) => {
  const calls: FakeQueryCall[] = [];
  // The runtime forwards the host environment into every spawned env by
  // design, so strip the routing vars for the suite's duration: on a machine
  // that carries ANTHROPIC_BASE_URL (a developer session routed through a
  // proxy), the assertions below would see that value in every spawned env
  // regardless of model resolution.
  const hostEnvOverrides: Record<string, string | undefined> = {
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  t.after(() => {
    for (const [key, value] of Object.entries(hostEnvOverrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
  // The agents directory the runtime checks an agent model against, found
  // through `CLAUDE_CONFIG_DIR` (a temporary HOME does not isolate
  // `os.homedir()` on Windows, this variable does).
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'claude-runtime-agents-'));
  const previousConfigDirectory = process.env.CLAUDE_CONFIG_DIR;
  await mkdir(path.join(configDirectory, 'agents'), { recursive: true });
  await writeFile(
    path.join(configDirectory, 'agents', 'relay-agent.md'),
    '---\nname: relay-agent\n---\n\nYou are the relay agent.\n',
    'utf8',
  );
  await writeFile(path.join(configDirectory, 'agents', 'empty-agent.md'), '---\nname: empty-agent\n---\n\n  \n', 'utf8');
  process.env.CLAUDE_CONFIG_DIR = configDirectory;
  t.after(async () => {
    if (previousConfigDirectory === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDirectory;
    }
    await rm(configDirectory, { recursive: true, force: true });
  });
  t.mock.module('@anthropic-ai/claude-agent-sdk', {
    namedExports: {
      query: (args: FakeQueryCall) => {
        calls.push(args);
        const messages = queuedMessages;
        queuedMessages = [];
        const streamError = queuedStreamError;
        queuedStreamError = null;
        return (async function* () {
          for (const message of messages) {
            yield message;
          }
          if (streamError) {
            throw streamError;
          }
        })();
      },
    },
  });

  const { queryClaudeSDK } = await import('@/modules/providers/list/claude/claude-runtime.provider.js');

  await t.test('routes a custom model with a Base URL/API key to that endpoint', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-1', model: 'local-model', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.env.ANTHROPIC_BASE_URL, 'http://localhost:11434');
    assert.equal(call?.options.env.ANTHROPIC_API_KEY, 'sk-local-123');
  });

  await t.test('a resumed session on that custom-endpoint model keeps routing to it', async () => {
    await queryClaudeSDK(
      'continue',
      { sessionId: 'session-1', model: 'local-model', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG, () => 'provider-session-99'),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.resume, 'provider-session-99');
    assert.equal(call?.options.env.ANTHROPIC_BASE_URL, 'http://localhost:11434');
    assert.equal(call?.options.env.ANTHROPIC_API_KEY, 'sk-local-123');
  });

  await t.test('leaves a built-in model\'s environment unchanged (no regression)', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-2', model: 'default', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.env.ANTHROPIC_BASE_URL, undefined);
    assert.equal(call?.options.env.ANTHROPIC_API_KEY, undefined);
  });

  await t.test('forwards a custom model\'s declared reasoning effort to the SDK', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-4', model: 'local-model-with-effort', effort: 'xhigh', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.effort, 'xhigh');
  });

  await t.test('drops a reasoning effort the custom model did not declare', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-5', model: 'local-model-with-effort', effort: 'max', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.effort, undefined);
  });

  await t.test('resolves the composer\'s "default" sentinel into the model\'s declared default', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-8', model: 'local-model-with-effort', effort: 'default', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.effort, 'medium');
  });

  // The external agent API omits `effort` rather than sending the sentinel, and
  // an omitted field has always meant "let the SDK decide". Resolving the
  // sentinel must not quietly swallow that second, distinct meaning.
  await t.test('leaves an omitted effort to the SDK even when the model declares a default', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-9', model: 'local-model-with-effort', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.effort, undefined);
  });

  await t.test('drops the sentinel for a model that declares no default', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-10', model: 'plain-model', effort: 'default', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.effort, undefined);
  });

  await t.test('leaves a plain custom model\'s environment unchanged (no regression)', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-3', model: 'plain-model', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.env.ANTHROPIC_BASE_URL, undefined);
    assert.equal(call?.options.env.ANTHROPIC_API_KEY, undefined);
  });
  await t.test('tells the spawned process a declared context window, in raw tokens', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-6', model: 'window-model', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '262144');
  });

  await t.test('declares the window for a custom model with no endpoint of its own', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-7', model: 'window-only-model', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '262144');
    assert.equal(call?.options.env.ANTHROPIC_BASE_URL, undefined);
    assert.equal(call?.options.env.ANTHROPIC_API_KEY, undefined);
  });

  await t.test('adds no context-window variable for a custom model that declares none', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-8', model: 'plain-model', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal('CLAUDE_CODE_MAX_CONTEXT_TOKENS' in call!.options.env, false);
  });

  await t.test('adds no context-window variable for a built-in model', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-9', model: 'default', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal('CLAUDE_CODE_MAX_CONTEXT_TOKENS' in call!.options.env, false);
  });

  await t.test('a resumed session on a window-declared model keeps the variable', async () => {
    await queryClaudeSDK(
      'continue',
      { sessionId: 'session-6', model: 'window-model', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG, () => 'provider-session-98'),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.resume, 'provider-session-98');
    assert.equal(call?.options.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '262144');
  });

  await t.test('warns once per session when Claude Code reports a different window', async () => {
    const mismatchResult = {
      type: 'result',
      modelUsage: { 'window-model': { contextWindow: 200_000, inputTokens: 10, outputTokens: 2 } },
    };

    const first = createFakeWs();
    queuedMessages = [mismatchResult];
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-mismatch', model: 'window-model', images: [], files: [] },
      first,
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const warnings = first.frames.filter((frame) => frame.kind === 'error');
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0].content), /CLAUDE_CODE_MAX_CONTEXT_TOKENS/);

    const second = createFakeWs();
    queuedMessages = [mismatchResult];
    await queryClaudeSDK(
      'again',
      { sessionId: 'session-mismatch', model: 'window-model', images: [], files: [] },
      second,
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    assert.deepEqual(second.frames.filter((frame) => frame.kind === 'error'), []);
  });

  await t.test('stays quiet when the reported window matches the declaration', async () => {
    const ws = createFakeWs();
    queuedMessages = [{
      type: 'result',
      modelUsage: { 'window-model': { contextWindow: 262_144, inputTokens: 10, outputTokens: 2 } },
    }];

    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-match', model: 'window-model', images: [], files: [] },
      ws,
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    assert.deepEqual(ws.frames.filter((frame) => frame.kind === 'error'), []);
  });

  // The custom-model system prompt source (fork entry 41): an agent name rides
  // in the SDK's `agent` option, a prompt text replaces the system prompt.
  await t.test('an agent model sends its agent name and keeps the default system prompt', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-agent', model: 'agent-model', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.agent, 'relay-agent');
    assert.deepEqual(call?.options.systemPrompt, DEFAULT_SYSTEM_PROMPT);
    assert.equal(call?.options.env.ANTHROPIC_BASE_URL, 'http://localhost:11434', 'the endpoint is untouched');
  });

  await t.test('a prompt model sends its text as the whole system prompt, with no agent', async () => {
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-prompt', model: 'prompt-model', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    const call = calls.at(-1);
    // A brand-new session (no resume) gets the source on its very first turn.
    assert.equal(call?.options.resume, undefined);
    assert.equal(call?.options.systemPrompt, CUSTOM_SYSTEM_PROMPT);
    assert.equal('agent' in call!.options, false);
    assert.equal(call?.options.env.ANTHROPIC_BASE_URL, 'http://localhost:11434', 'the endpoint is untouched');
  });

  await t.test('a resumed session keeps sending the system prompt source', async () => {
    await queryClaudeSDK(
      'continue',
      { sessionId: 'session-agent', model: 'agent-model', images: [], files: [] },
      createFakeWs(),
      createFakeContext(CUSTOM_ENDPOINT_CATALOG, () => 'provider-session-97'),
    );

    const call = calls.at(-1);
    assert.equal(call?.options.resume, 'provider-session-97');
    assert.equal(call?.options.agent, 'relay-agent');
    assert.deepEqual(call?.options.systemPrompt, DEFAULT_SYSTEM_PROMPT);
  });

  for (const model of ['default', 'plain-model', 'local-model', 'window-model']) {
    await t.test(`model "${model}" keeps the default system prompt and no agent (no regression)`, async () => {
      await queryClaudeSDK(
        'hello',
        { sessionId: `session-default-${model}`, model, images: [], files: [] },
        createFakeWs(),
        createFakeContext(CUSTOM_ENDPOINT_CATALOG),
      );

      const call = calls.at(-1);
      assert.deepEqual(call?.options.systemPrompt, DEFAULT_SYSTEM_PROMPT);
      assert.equal('agent' in call!.options, false);
    });
  }

  // Measured against CLI 2.1.326 / SDK 0.3.322 (M2): an unknown `agent` makes
  // the CLI report nothing — the run proceeds on the default prompt, which the
  // endpoint behind a custom model may reject. So the runtime checks the agent
  // file itself before it sends anything.
  for (const [model, label] of [
    ['ghost-agent-model', 'no agent file'],
    ['empty-agent-model', 'an agent file with an empty body'],
  ] as const) {
    await t.test(`an agent model with ${label} fails the turn before any query is sent`, async () => {
      const callsBefore = calls.length;
      const ws = createFakeWs();
      await queryClaudeSDK(
        'hello',
        { sessionId: `session-precheck-${model}`, model, images: [], files: [] },
        ws,
        createFakeContext(CUSTOM_ENDPOINT_CATALOG),
      );

      assert.equal(calls.length, callsBefore, 'no query, so nothing reaches the endpoint on the default prompt');
      const errors = ws.frames.filter((frame) => frame.kind === 'error');
      assert.equal(errors.length, 1);
      assert.match(
        String(errors[0].content),
        /^Agent "(ghost|empty)-agent" was not found, could not be read, or has an empty prompt\. Pick another agent or fix the file in the model settings\.$/,
      );
      const completes = ws.frames.filter((frame) => frame.kind === 'complete');
      assert.equal(completes.length, 1);
      assert.equal(completes[0].exitCode, 1);
    });
  }

  await t.test('an agent model whose file exists runs without any error frame', async () => {
    const ws = createFakeWs();
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-precheck-ok', model: 'agent-model', images: [], files: [] },
      ws,
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    assert.equal(calls.at(-1)?.options.agent, 'relay-agent');
    assert.deepEqual(ws.frames.filter((frame) => frame.kind === 'error'), []);
  });

  await t.test('prompt and default models never look at the agents directory', async () => {
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = path.join(configDirectory, 'does-not-exist');
    try {
      for (const model of ['prompt-model', 'default']) {
        const ws = createFakeWs();
        const callsBefore = calls.length;
        await queryClaudeSDK(
          'hello',
          { sessionId: `session-precheck-skip-${model}`, model, images: [], files: [] },
          ws,
          createFakeContext(CUSTOM_ENDPOINT_CATALOG),
        );

        assert.equal(calls.length, callsBefore + 1, `${model} still sends its query`);
        assert.deepEqual(ws.frames.filter((frame) => frame.kind === 'error'), []);
      }
    } finally {
      process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });

  // What the runtime does with a CLI failure on an agent turn, whatever its cause.
  await t.test('a failed agent run is reported as the run error, never retried on the default prompt', async () => {
    const callsBefore = calls.length;
    const ws = createFakeWs();
    queuedStreamError = new Error('Agent "relay-agent" not found. Available agents: quick');
    await queryClaudeSDK(
      'hello',
      { sessionId: 'session-missing-agent', model: 'agent-model', images: [], files: [] },
      ws,
      createFakeContext(CUSTOM_ENDPOINT_CATALOG),
    );

    assert.equal(calls.length, callsBefore + 1, 'one query only: no second run without the agent');
    const errors = ws.frames.filter((frame) => frame.kind === 'error');
    assert.equal(errors.length, 1);
    assert.match(String(errors[0].content), /Agent "relay-agent" not found/);
  });
});
