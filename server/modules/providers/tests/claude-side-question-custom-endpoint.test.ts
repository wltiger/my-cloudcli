import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { claudeRuntime, queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type {
  AnyRecord,
  ProviderModelsDefinition,
  ProviderRuntimeContext,
  SideQuestionOutcome,
  SideQuestionRequest,
} from '@/shared/types.js';

/**
 * Seam: `claudeRuntime.askSideQuestion` for a session with no live process,
 * which answers on a read-only fork. The fork is a new CLI process, so a
 * custom model with its own Base URL / API Key (fork entry 25) has to reach
 * it through the environment, the same way a turn does — otherwise the fork
 * sends the custom model id to the logged-in subscription instead. The same
 * goes for a model's replacement system prompt (fork entry 41): the fork
 * cannot look an agent up by name, so the runtime reads the agent file itself.
 */

const PROMPT_TEXT = 'Answer only in haiku.\n\nNever mention tools.';
const AGENT_BODY = 'You are the relay agent.\nStay brief.';

const MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'proxy-model', label: 'Proxy model', baseUrl: 'https://proxy.example.test/v1', apiKey: 'test-key' },
    { value: 'prompt-model', label: 'Prompt model', isCustom: true, systemPrompt: PROMPT_TEXT },
    {
      value: 'proxy-prompt-model',
      label: 'Proxy prompt model',
      isCustom: true,
      baseUrl: 'https://proxy.example.test/v1',
      apiKey: 'test-key',
      systemPrompt: PROMPT_TEXT,
    },
    { value: 'agent-model', label: 'Agent model', isCustom: true, systemPromptAgent: 'relay-agent' },
    { value: 'ghost-agent-model', label: 'Ghost agent model', isCustom: true, systemPromptAgent: 'ghost-agent' },
    { value: 'empty-agent-model', label: 'Empty agent model', isCustom: true, systemPromptAgent: 'empty-agent' },
  ],
  DEFAULT: 'sonnet',
};

// The agents directory the runtime resolves through `CLAUDE_CONFIG_DIR`: on
// Windows a temporary HOME does not isolate `os.homedir()`, this variable does.
let configDirectory = '';
let previousConfigDirectory: string | undefined;

before(async () => {
  configDirectory = await mkdtemp(path.join(tmpdir(), 'claude-side-question-agents-'));
  const agentsDirectory = path.join(configDirectory, 'agents');
  await mkdir(agentsDirectory, { recursive: true });
  // The `tools:` line is a restriction the fork must not apply.
  await writeFile(
    path.join(agentsDirectory, 'relay-agent.md'),
    `---\nname: relay-agent\ndescription: Relay\ntools: Read\n---\n\n${AGENT_BODY}\n`,
    'utf8',
  );
  await writeFile(path.join(agentsDirectory, 'empty-agent.md'), '---\nname: empty-agent\n---\n\n   \n', 'utf8');
  previousConfigDirectory = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDirectory;
});

after(async () => {
  if (previousConfigDirectory === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDirectory;
  }
  await rm(configDirectory, { recursive: true, force: true });
});

function captureForkOptions(): {
  createQuery: NonNullable<ProviderRuntimeContext['createQuery']>;
  options: () => AnyRecord | null;
  calls: () => number;
} {
  let captured: AnyRecord | null = null;
  let calls = 0;
  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = (params) => {
    calls += 1;
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
  return { createQuery, options: () => captured, calls: () => calls };
}

function context(
  createQuery: NonNullable<ProviderRuntimeContext['createQuery']>,
  getProviderModels: ProviderRuntimeContext['getProviderModels'] = async () => MODELS,
): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
    createQuery,
  };
}

function request(model: string, appSessionId = `side-question-endpoint-${model}`): SideQuestionRequest {
  return {
    appSessionId,
    providerSessionId: 'native-session',
    projectPath: null,
    question: 'What does this repo do?',
    model,
    signal: new AbortController().signal,
  };
}

/** The preset's `append`: what every fork adds to the prompt it runs under. */
async function readForkAppend(): Promise<string> {
  const fork = captureForkOptions();
  await claudeRuntime.askSideQuestion(request('sonnet'), { delta: () => {} }, context(fork.createQuery));
  const append = (fork.options()?.systemPrompt as AnyRecord | undefined)?.append;
  assert.equal(typeof append, 'string', 'the default fork carries the side-question instruction');
  return append as string;
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

test('a side question on a default-prompt model keeps the fork on the default preset', async () => {
  for (const model of ['sonnet', 'proxy-model']) {
    const fork = captureForkOptions();
    const outcome = await claudeRuntime.askSideQuestion(request(model), { delta: () => {} }, context(fork.createQuery));

    assert.equal(outcome.status, 'done');
    const systemPrompt = fork.options()?.systemPrompt as AnyRecord;
    assert.equal(systemPrompt.type, 'preset', `${model} stays on the default prompt`);
    assert.equal(systemPrompt.preset, 'claude_code');
    assert.equal('snapshot' in systemPrompt, false);
  }
});

test('a side question on a prompt model replaces the fork prompt with its text plus the side-question note', async () => {
  const append = await readForkAppend();
  const fork = captureForkOptions();
  const outcome = await claudeRuntime.askSideQuestion(request('prompt-model'), { delta: () => {} }, context(fork.createQuery));

  assert.equal(outcome.status, 'done');
  const options = fork.options() as AnyRecord;
  assert.deepEqual(options.systemPrompt, { type: 'custom', prompt: `${PROMPT_TEXT}\n\n${append}`, snapshot: false });
  assert.deepEqual(options.tools, ['Read', 'Grep', 'Glob'], 'the fork stays read-only');
  assert.deepEqual(options.allowedTools, ['Read', 'Grep', 'Glob']);
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.forkSession, true);
  assert.equal(options.resume, 'native-session');
});

test('a prompt model with its own endpoint keeps the endpoint and replaces the prompt', async () => {
  const append = await readForkAppend();
  const fork = captureForkOptions();
  const outcome = await claudeRuntime.askSideQuestion(request('proxy-prompt-model'), { delta: () => {} }, context(fork.createQuery));

  assert.equal(outcome.status, 'done');
  const options = fork.options() as AnyRecord;
  assert.equal((options.env as NodeJS.ProcessEnv).ANTHROPIC_BASE_URL, 'https://proxy.example.test/v1');
  assert.deepEqual(options.systemPrompt, { type: 'custom', prompt: `${PROMPT_TEXT}\n\n${append}`, snapshot: false });
});

test('a side question on an agent model uses the agent file body as the fork prompt, without its tool limits', async () => {
  const append = await readForkAppend();
  const fork = captureForkOptions();
  const outcome = await claudeRuntime.askSideQuestion(request('agent-model'), { delta: () => {} }, context(fork.createQuery));

  assert.equal(outcome.status, 'done');
  const options = fork.options() as AnyRecord;
  assert.deepEqual(options.systemPrompt, { type: 'custom', prompt: `${AGENT_BODY}\n\n${append}`, snapshot: false });
  assert.deepEqual(options.tools, ['Read', 'Grep', 'Glob'], 'the agent\'s `tools: Read` is not applied to the fork');
  assert.equal('agent' in options, false, 'the fork cannot find an agent by name, so none is passed');
  assert.equal(options.model, 'agent-model', 'the fork keeps the session\'s model');
});

for (const [model, label] of [
  ['ghost-agent-model', 'no agent file'],
  ['empty-agent-model', 'an agent file with an empty body'],
] as const) {
  test(`a side question on an agent model with ${label} reports an error and never starts the fork`, async () => {
    const fork = captureForkOptions();
    const deltas: string[] = [];
    const outcome = await claudeRuntime.askSideQuestion(
      request(model),
      { delta: (text: string) => { deltas.push(text); } },
      context(fork.createQuery),
    );

    assert.equal(outcome.status, 'error');
    assert.equal(outcome.answer, '');
    assert.match(String(outcome.error), /Agent "(ghost|empty)-agent" was not found, could not be read, or has an empty prompt\./);
    assert.equal(fork.calls(), 0, 'no fork on the default prompt');
    assert.deepEqual(deltas, []);
  });
}

test('a side question still runs on the default prompt when the model catalog cannot be read', async () => {
  const fork = captureForkOptions();
  const outcome = await claudeRuntime.askSideQuestion(
    request('prompt-model'),
    { delta: () => {} },
    context(fork.createQuery, async () => { throw new Error('database is locked'); }),
  );

  // Known limitation (spec decision 4): the existing endpoint lookup fails open
  // the same way, so a custom model's overrides are simply not found.
  assert.equal(outcome.status, 'done');
  assert.equal((fork.options()?.systemPrompt as AnyRecord | undefined)?.type, 'preset');
});

// The retry call site: a native question the CLI cancelled because its process
// was let go (a new turn superseded it) is asked again on the fork.

type NativeAsk = () => Promise<unknown>;

/** A scripted live query for one session, with a native `askSideQuestion`. */
function createLiveQuery(askSideQuestion: NativeAsk): {
  createQuery: NonNullable<ProviderRuntimeContext['createQuery']>;
  emit: (message: AnyRecord) => void;
  end: () => void;
  released: () => boolean;
  consumed: () => number;
} {
  const queue: Array<AnyRecord | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  let consumed = 0;

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
      released = true;
    })();
    const iterator = (async function* () {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        const next = queue.shift();
        if (next === null || next === undefined) {
          return;
        }
        yield next;
        consumed += 1;
      }
    })();
    const instance = Object.assign(iterator, {
      interrupt: async () => {},
      stopTask: async () => {},
      askSideQuestion(this: unknown) {
        if (this !== instance) {
          throw new TypeError('askSideQuestion was called without its query as `this`');
        }
        return askSideQuestion();
      },
    });
    return instance as never;
  };

  return {
    createQuery,
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    consumed: () => consumed,
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      assert.ok(condition(), `condition never became true within ${timeoutMs}ms`);
      return;
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, 5); });
  }
}

/**
 * Runs the cancelled-native-question scenario for a side question on `model`
 * and returns what the retried fork saw. The live turns run on a built-in
 * model: a turn on an agent model whose file is gone fails before it starts.
 */
async function askCancelledNativeQuestion(
  model: string,
  appSessionId: string,
): Promise<{ outcome: SideQuestionOutcome; fork: ReturnType<typeof captureForkOptions> }> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'claude-side-question-retry-'));
  const writer = { send: () => {}, userId: null };
  let rejectNative!: (error: unknown) => void;
  let nativeCalled = false;
  const first = createLiveQuery(() => {
    nativeCalled = true;
    return new Promise((_resolve, reject) => { rejectNative = reject; });
  });
  const second = createLiveQuery(async () => ({ response: 'unused', synthetic: false }));
  const fork = captureForkOptions();

  try {
    const firstRun = queryClaudeSDK('hello', { sessionId: appSessionId, cwd, model: 'sonnet' }, writer as never, context(first.createQuery));
    first.emit({ type: 'system', subtype: 'init', session_id: 'native-session' });
    await waitFor(() => first.consumed() > 0);

    const asked = claudeRuntime.askSideQuestion(request(model, appSessionId), { delta: () => {} }, context(fork.createQuery));
    await waitFor(() => nativeCalled);

    // A new turn on the same session lets the first process go while the
    // native question is still out; the CLI then cancels that question.
    const secondRun = queryClaudeSDK('continue', { sessionId: appSessionId, cwd, model: 'sonnet' }, writer as never, context(second.createQuery));
    await waitFor(() => first.released());
    rejectNative(new Error('Side question cancelled'));
    const outcome = await asked;

    first.end();
    await firstRun;
    second.emit({ type: 'system', subtype: 'init', session_id: 'native-session' });
    second.emit({ type: 'result', subtype: 'success', session_id: 'native-session', result: 'done', duration_ms: 1, num_turns: 1 });
    second.end();
    await secondRun;
    return { outcome, fork };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test('a retried side question on a prompt model runs the fork on the replacement prompt', { concurrency: false }, async () => {
  const append = await readForkAppend();
  const { outcome, fork } = await askCancelledNativeQuestion('prompt-model', 'app-side-question-prompt-retry');

  assert.equal(outcome.status, 'done');
  assert.equal(fork.calls(), 1);
  assert.deepEqual(
    fork.options()?.systemPrompt,
    { type: 'custom', prompt: `${PROMPT_TEXT}\n\n${append}`, snapshot: false },
  );
});

test('a retried side question on an agent model runs the fork on the agent body', { concurrency: false }, async () => {
  const append = await readForkAppend();
  const { outcome, fork } = await askCancelledNativeQuestion('agent-model', 'app-side-question-agent-retry');

  assert.equal(outcome.status, 'done');
  assert.deepEqual(
    fork.options()?.systemPrompt,
    { type: 'custom', prompt: `${AGENT_BODY}\n\n${append}`, snapshot: false },
  );
});

test('a retried side question on a missing agent reports an error and never starts the fork', { concurrency: false }, async () => {
  const { outcome, fork } = await askCancelledNativeQuestion('ghost-agent-model', 'app-side-question-ghost-retry');

  assert.equal(outcome.status, 'error');
  assert.match(String(outcome.error), /Agent "ghost-agent" was not found/);
  assert.equal(fork.calls(), 0);
});
