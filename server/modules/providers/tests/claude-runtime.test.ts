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
  ],
  DEFAULT: 'default',
};

type FakeQueryCall = { prompt: unknown; options: Record<string, any> };

const createFakeWs = () => ({
  userId: null as string | null,
  send: () => {},
  setSessionId: () => {},
});

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
  t.mock.module('@anthropic-ai/claude-agent-sdk', {
    namedExports: {
      query: (args: FakeQueryCall) => {
        calls.push(args);
        return (async function* () {})();
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
});
