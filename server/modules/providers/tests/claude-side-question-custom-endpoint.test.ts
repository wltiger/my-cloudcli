import assert from 'node:assert/strict';
import test from 'node:test';

import { claudeRuntime } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type {
  AnyRecord,
  ProviderModelsDefinition,
  ProviderRuntimeContext,
  SideQuestionRequest,
} from '@/shared/types.js';

/**
 * Seam: `claudeRuntime.askSideQuestion` for a session with no live process,
 * which answers on a read-only fork. The fork is a new CLI process, so a
 * custom model with its own Base URL / API Key (fork entry 25) has to reach
 * it through the environment, the same way a turn does — otherwise the fork
 * sends the custom model id to the logged-in subscription instead.
 */

const MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'proxy-model', label: 'Proxy model', baseUrl: 'https://proxy.example.test/v1', apiKey: 'test-key' },
  ],
  DEFAULT: 'sonnet',
};

function captureForkOptions(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; options: () => AnyRecord | null } {
  let captured: AnyRecord | null = null;
  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = (params) => {
    captured = (params as { options: AnyRecord }).options;
    const iterator = (async function* () {
      yield {
        type: 'assistant', session_id: 'fork-session', parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
      };
      yield { type: 'result', subtype: 'success', session_id: 'fork-session', result: 'answer', duration_ms: 1, num_turns: 1 };
    })();
    return Object.assign(iterator, { interrupt: async () => {} }) as never;
  };
  return { createQuery, options: () => captured };
}

function context(createQuery: NonNullable<ProviderRuntimeContext['createQuery']>): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => MODELS,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
    createQuery,
  };
}

function request(model: string): SideQuestionRequest {
  return {
    appSessionId: `side-question-endpoint-${model}`,
    providerSessionId: 'native-session',
    projectPath: null,
    question: 'What does this repo do?',
    model,
    signal: new AbortController().signal,
  };
}

test('a side question on a custom-endpoint model sends its fork to that endpoint, with the full environment', async () => {
  const fork = captureForkOptions();
  const outcome = await claudeRuntime.askSideQuestion(request('proxy-model'), { delta: () => {} }, context(fork.createQuery));

  assert.equal(outcome.status, 'done');
  const env = fork.options()?.env as NodeJS.ProcessEnv | undefined;
  assert.ok(env, 'the fork gets an environment of its own');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://proxy.example.test/v1');
  assert.equal(env.ANTHROPIC_API_KEY, 'test-key');
  assert.ok(
    Object.keys(env).some((key) => key.toLowerCase() === 'path'),
    'the process environment is kept, so the CLI can still start',
  );
});

test('a side question on a built-in model leaves the fork environment alone', async () => {
  const fork = captureForkOptions();
  const outcome = await claudeRuntime.askSideQuestion(request('sonnet'), { delta: () => {} }, context(fork.createQuery));

  assert.equal(outcome.status, 'done');
  assert.equal(fork.options()?.env, undefined, 'no override: the fork inherits the process environment as before');
});
