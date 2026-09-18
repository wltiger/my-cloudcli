import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProviderModelsDefinition } from '@/shared/types.js';

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

const createFakeContext = (
  modelsDefinition: ProviderModelsDefinition,
  resolveProviderSessionId: (sessionId?: string) => string | undefined = () => undefined,
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
  t.mock.module('@anthropic-ai/claude-agent-sdk', {
    namedExports: {
      query: (args: FakeQueryCall) => {
        calls.push(args);
        const messages = queuedMessages;
        queuedMessages = [];
        return (async function* () {
          for (const message of messages) {
            yield message;
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
});
