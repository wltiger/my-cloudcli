import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ModelLibraryPanel from '@/modules/chat/modals/ModelLibraryPanel';
import type {
  ClaudeAgentSummary,
  CustomProviderModelInput,
  LLMProvider,
  ProviderModelActions,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types';

/**
 * Fork: a Claude custom model can replace Claude Code's default system prompt
 * with an agent's prompt or a custom text (fork-customizations entry 41). The
 * server owns validation and the runtime; these tests pin the client half: the
 * Model Library form's three-way choice, the agent dropdown fed by
 * `GET /api/providers/claude/agents`, and the payload each choice sends. The
 * payload is compared with strict `deepEqual` because an update that omits both
 * keys is what clears the stored choice.
 */

const PLAIN_MODEL: ProviderModelOption = {
  value: 'plain-model',
  label: 'Plain Model',
  recordId: 1,
  isCustom: true,
};
const AGENT_MODEL: ProviderModelOption = {
  value: 'agent-model',
  label: 'Agent Model',
  recordId: 2,
  isCustom: true,
  systemPromptAgent: 'quick',
};
const PROMPT_MODEL: ProviderModelOption = {
  value: 'prompt-model',
  label: 'Prompt Model',
  recordId: 3,
  isCustom: true,
  systemPrompt: 'You are terse.\nNo emoji.',
};
const MISSING_AGENT_MODEL: ProviderModelOption = {
  value: 'missing-agent-model',
  label: 'Missing Agent Model',
  recordId: 4,
  isCustom: true,
  systemPromptAgent: 'deleted-agent',
};

const CATALOG: Partial<Record<LLMProvider, ProviderModelsDefinition>> = {
  claude: {
    OPTIONS: [
      { value: 'default', label: 'Default', isCustom: false },
      PLAIN_MODEL,
      AGENT_MODEL,
      PROMPT_MODEL,
      MISSING_AGENT_MODEL,
    ],
    DEFAULT: 'default',
    EFFORT_LEVELS: [],
  },
  cursor: {
    OPTIONS: [{ value: 'auto', label: 'Auto', isCustom: false }],
    DEFAULT: 'auto',
    EFFORT_LEVELS: [],
  },
};

const AGENTS: ClaudeAgentSummary[] = [
  { name: 'plain', description: 'No limits at all', tools: null, disallowedTools: null },
  { name: 'quick', description: 'Fast lookups', tools: ['Read', 'Grep', 'Glob'], disallowedTools: null },
  { name: 'safe', description: 'Never shells out', tools: null, disallowedTools: ['Bash'] },
  { name: 'bare', description: 'Nothing allowed', tools: [], disallowedTools: null },
];

const AGENTS_URL = '/api/providers/claude/agents';

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});
const agentsOk = () => jsonResponse(200, { success: true, data: { agents: AGENTS } });

let agentsReply: () => Promise<Response>;
const fetchMock = vi.fn((_url: string) => agentsReply());

const agentRequestCount = () => fetchMock.mock.calls.filter(([url]) => url === AGENTS_URL).length;

const createActions = () => {
  const created: Array<{ provider: LLMProvider; input: CustomProviderModelInput }> = [];
  const updated: Array<{ provider: LLMProvider; input: CustomProviderModelInput }> = [];
  const actions: ProviderModelActions = {
    create: async (provider, input) => {
      created.push({ provider, input });
    },
    update: async (provider, _existing, input) => {
      updated.push({ provider, input });
    },
    remove: async () => {},
    setCustomModelsOnly: async () => {},
  };
  return { actions, created, updated };
};

const renderPanel = (initialProvider: LLMProvider = 'claude') => {
  const harness = createActions();
  render(
    <ModelLibraryPanel
      initialProvider={initialProvider}
      providerModelCatalog={CATALOG}
      actions={harness.actions}
    />,
  );
  return harness;
};

const fillNameAndId = () => {
  fireEvent.change(screen.getByLabelText('Model name'), { target: { value: 'Gateway Claude' } });
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'gateway-claude' } });
};

const chooseMode = (name: 'Default prompt' | 'Use an agent' | 'Custom prompt') => {
  fireEvent.click(screen.getByRole('radio', { name }));
};

const agentSelect = () => screen.getByLabelText('Agent') as HTMLSelectElement;
const promptBox = () => screen.getByLabelText('System prompt text') as HTMLTextAreaElement;

/** Waits for the dropdown to leave its loading state. */
const agentsLoaded = () => waitFor(() => assert.equal(agentSelect().disabled, false));

beforeEach(() => {
  agentsReply = () => Promise.resolve(agentsOk());
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('the Claude form offers the three-way choice and other providers do not', () => {
  renderPanel('claude');

  assert.equal(screen.queryByRole('radio', { name: 'Default prompt' }) !== null, true);
  assert.equal(screen.queryByRole('radio', { name: 'Use an agent' }) !== null, true);
  assert.equal(screen.queryByRole('radio', { name: 'Custom prompt' }) !== null, true);
  assert.equal(screen.queryByRole('radio', { name: 'Default prompt', checked: true }) !== null, true);

  fireEvent.click(screen.getByText('Cursor'));
  assert.equal(screen.queryByRole('radio', { name: 'Use an agent' }) === null, true);
  assert.equal(screen.queryByRole('radio', { name: 'Custom prompt' }) === null, true);
});

test('editing a model opens in the mode that matches what it stores', async () => {
  renderPanel();

  fireEvent.click(screen.getByRole('button', { name: 'Edit Plain Model' }));
  assert.equal(screen.queryByRole('radio', { name: 'Default prompt', checked: true }) !== null, true);

  fireEvent.click(screen.getByRole('button', { name: 'Edit Agent Model' }));
  assert.equal(screen.queryByRole('radio', { name: 'Use an agent', checked: true }) !== null, true);
  await agentsLoaded();
  assert.equal(agentSelect().value, 'quick');

  fireEvent.click(screen.getByRole('button', { name: 'Edit Prompt Model' }));
  assert.equal(screen.queryByRole('radio', { name: 'Custom prompt', checked: true }) !== null, true);
  assert.equal(promptBox().value, 'You are terse.\nNo emoji.');
});

test('agent mode lists each agent with its description and marks the ones that limit tools', async () => {
  renderPanel();
  fillNameAndId();

  chooseMode('Use an agent');
  await agentsLoaded();

  const names = within(agentSelect()).getAllByRole('option').map((option) => option.textContent);
  assert.deepEqual(names, [
    'Choose an agent…',
    'plain — No limits at all',
    'quick — Fast lookups (limits tools: Read, Grep, Glob)',
    'safe — Never shells out (blocks tools: Bash)',
    'bare — Nothing allowed (limits tools)',
  ]);
  assert.equal(screen.queryByText(/tool limits to the chat/) !== null, true);
});

test('the agent list is fetched once, only when agent mode is first shown', async () => {
  renderPanel();
  fillNameAndId();
  await Promise.resolve();
  assert.equal(agentRequestCount(), 0, 'default mode must not load agents');

  chooseMode('Custom prompt');
  assert.equal(agentRequestCount(), 0, 'prompt mode must not load agents');

  chooseMode('Use an agent');
  await agentsLoaded();
  assert.equal(agentRequestCount(), 1);

  chooseMode('Custom prompt');
  chooseMode('Use an agent');
  chooseMode('Default prompt');
  chooseMode('Use an agent');
  assert.equal(agentSelect().disabled, false);
  assert.equal(agentRequestCount(), 1, 'switching modes must not refetch');
});

test('another provider never loads the agent list', async () => {
  renderPanel('cursor');
  await Promise.resolve();
  assert.equal(agentRequestCount(), 0);
});

test('a multi-line prompt is saved exactly through create and through update', async () => {
  const prompt = 'You are a terse assistant.\n\nRule 1: be brief.\nRule 2: no emoji.';
  const { created, updated } = renderPanel();

  fillNameAndId();
  chooseMode('Custom prompt');
  fireEvent.change(promptBox(), { target: { value: prompt } });
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
  await waitFor(() => assert.equal(created.length, 1));
  assert.deepEqual(created[0]?.input, {
    model: 'Gateway Claude',
    id: 'gateway-claude',
    contextWindow: undefined,
    systemPrompt: prompt,
  });

  fireEvent.click(screen.getByRole('button', { name: 'Edit Prompt Model' }));
  fireEvent.change(promptBox(), { target: { value: `${prompt}\nRule 3: ask first.` } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(updated.length, 1));
  assert.deepEqual(updated[0]?.input, {
    model: 'Prompt Model',
    id: 'prompt-model',
    contextWindow: undefined,
    systemPrompt: `${prompt}\nRule 3: ask first.`,
  });
});

test('switching modes keeps both typed values', async () => {
  renderPanel();

  chooseMode('Use an agent');
  await agentsLoaded();
  fireEvent.change(agentSelect(), { target: { value: 'safe' } });

  chooseMode('Custom prompt');
  fireEvent.change(promptBox(), { target: { value: 'Typed once.\nSecond line.' } });

  chooseMode('Use an agent');
  assert.equal(agentSelect().value, 'safe');

  chooseMode('Custom prompt');
  assert.equal(promptBox().value, 'Typed once.\nSecond line.');
});

test('the default mode sends neither key', async () => {
  const { created } = renderPanel();

  fillNameAndId();
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
  await waitFor(() => assert.equal(created.length, 1));

  const input = created[0]?.input ?? ({} as CustomProviderModelInput);
  assert.deepEqual(input, { model: 'Gateway Claude', id: 'gateway-claude', contextWindow: undefined });
  assert.equal('systemPrompt' in input, false);
  assert.equal('systemPromptAgent' in input, false);
});

test('the agent mode sends only the agent name', async () => {
  const { created } = renderPanel();

  fillNameAndId();
  chooseMode('Use an agent');
  await agentsLoaded();
  fireEvent.change(agentSelect(), { target: { value: 'quick' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
  await waitFor(() => assert.equal(created.length, 1));

  const input = created[0]?.input ?? ({} as CustomProviderModelInput);
  assert.deepEqual(input, {
    model: 'Gateway Claude',
    id: 'gateway-claude',
    contextWindow: undefined,
    systemPromptAgent: 'quick',
  });
  assert.equal('systemPrompt' in input, false);
});

test('the prompt mode sends only the prompt text', async () => {
  const { created } = renderPanel();

  fillNameAndId();
  chooseMode('Custom prompt');
  fireEvent.change(promptBox(), { target: { value: '  Be brief.  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
  await waitFor(() => assert.equal(created.length, 1));

  const input = created[0]?.input ?? ({} as CustomProviderModelInput);
  assert.deepEqual(input, {
    model: 'Gateway Claude',
    id: 'gateway-claude',
    contextWindow: undefined,
    systemPrompt: 'Be brief.',
  });
  assert.equal('systemPromptAgent' in input, false);
});

test('an empty choice behaves like the default and sends neither key', async () => {
  const { created } = renderPanel();

  fillNameAndId();
  chooseMode('Custom prompt');
  fireEvent.change(promptBox(), { target: { value: '   \n ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
  await waitFor(() => assert.equal(created.length, 1));

  chooseMode('Use an agent');
  await agentsLoaded();
  fillNameAndId();
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
  await waitFor(() => assert.equal(created.length, 2));

  for (const { input } of created) {
    assert.deepEqual(input, { model: 'Gateway Claude', id: 'gateway-claude', contextWindow: undefined });
  }
});

test('changing an agent model to a prompt sends only the prompt', async () => {
  const { updated } = renderPanel();

  fireEvent.click(screen.getByRole('button', { name: 'Edit Agent Model' }));
  await agentsLoaded();
  chooseMode('Custom prompt');
  fireEvent.change(promptBox(), { target: { value: 'Now a prompt.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(updated.length, 1));

  const input = updated[0]?.input ?? ({} as CustomProviderModelInput);
  assert.deepEqual(input, {
    model: 'Agent Model',
    id: 'agent-model',
    contextWindow: undefined,
    systemPrompt: 'Now a prompt.',
  });
  assert.equal('systemPromptAgent' in input, false);
});

test('changing a replaced model back to the default sends neither key, which clears it', async () => {
  const { updated } = renderPanel();

  fireEvent.click(screen.getByRole('button', { name: 'Edit Prompt Model' }));
  chooseMode('Default prompt');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(updated.length, 1));

  fireEvent.click(screen.getByRole('button', { name: 'Edit Agent Model' }));
  await agentsLoaded();
  chooseMode('Default prompt');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(updated.length, 2));

  for (const { input } of updated) {
    assert.equal('systemPrompt' in input, false);
    assert.equal('systemPromptAgent' in input, false);
  }
});

test('a model whose agent file is gone keeps its name, marked, and saves it unchanged', async () => {
  const { updated } = renderPanel();

  fireEvent.click(screen.getByRole('button', { name: 'Edit Missing Agent Model' }));
  // While the list loads, the stored name is shown as it is.
  assert.equal(agentSelect().value, 'deleted-agent');
  await agentsLoaded();

  assert.equal(agentSelect().value, 'deleted-agent');
  const missing = within(agentSelect()).getByRole('option', { name: 'deleted-agent (file not found)' });
  assert.equal((missing as HTMLOptionElement).selected, true);

  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(updated.length, 1));
  assert.deepEqual(updated[0]?.input, {
    model: 'Missing Agent Model',
    id: 'missing-agent-model',
    contextWindow: undefined,
    systemPromptAgent: 'deleted-agent',
  });
});

test('the dropdown is disabled with a loading line while the agents are on their way', async () => {
  let release: (response: Response) => void = () => {};
  agentsReply = () => new Promise<Response>((resolve) => {
    release = resolve;
  });
  renderPanel();

  chooseMode('Use an agent');
  assert.equal(agentSelect().disabled, true);
  assert.equal(within(agentSelect()).queryByRole('option', { name: 'Loading agents…' }) !== null, true);

  release(agentsOk());
  await agentsLoaded();
  assert.equal(within(agentSelect()).queryByRole('option', { name: 'Loading agents…' }) === null, true);
});

const FAILURES: Array<[string, () => Promise<Response>]> = [
  ['the server answers with an error', () => Promise.resolve(jsonResponse(500, { success: false, error: 'boom' }))],
  ['the request itself fails', () => Promise.reject(new TypeError('Failed to fetch'))],
];

for (const [reason, reply] of FAILURES) {
  test(`when ${reason}, the form says so and still saves the current choice`, async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    agentsReply = reply;
    const { updated, created } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Agent Model' }));
    await waitFor(() => assert.equal(screen.queryByText('Could not load agents') !== null, true));
    assert.equal(agentSelect().disabled, false);
    assert.equal(agentSelect().value, 'quick');
    assert.equal(within(agentSelect()).queryByRole('option', { name: /file not found/ }) === null, true);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => assert.equal(updated.length, 1));
    assert.equal(updated[0]?.input.systemPromptAgent, 'quick');

    // The other two choices stay usable.
    fillNameAndId();
    chooseMode('Custom prompt');
    fireEvent.change(promptBox(), { target: { value: 'Still works.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    await waitFor(() => assert.equal(created.length, 1));
    assert.equal(created[0]?.input.systemPrompt, 'Still works.');
    assert.equal(agentRequestCount(), 1);
  });
}
