/**
 * Antigravity runtime — the pure parse/assembly layer.
 *
 * Nothing here spawns `agy`: the process wrapper is deliberately left to
 * manual verification, and these tests drive the functions that decide what a
 * turn is billed, what a refusal reports, and which flags the command line
 * carries.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { AppError } from '@/shared/utils.js';

// The runtime reaches the notifications barrel, which opens the shared SQLite
// connection while it is still being imported. Pointing it at a throwaway file
// first is what keeps a test from touching the database the app actually uses;
// the import below has to be dynamic for the same reason.
const temporaryDatabasePath = path.join(
  os.tmpdir(),
  `antigravity-runtime-test-${process.pid}.db`,
);
process.env.DATABASE_PATH = temporaryDatabasePath;

const {
  buildAntigravityArgs,
  buildAntigravityTokenBudget,
  buildRefusedAction,
  collectGrantRuleCandidates,
  createAntigravityTurnState,
  foldAntigravityEventLine,
  resolveAntigravityPermissionArgs,
} = await import('@/modules/providers/list/antigravity/antigravity-runtime.provider.js');

after(async () => {
  const { closeConnection } = await import('@/modules/database/index.js');
  closeConnection();
  await fs.rm(temporaryDatabasePath, { force: true });
});

// ---------------------------------------------------------------------------
// Token budget — per-step usage, never the conversation-cumulative figure
// ---------------------------------------------------------------------------

test('a turn is billed on the step usage it reports', () => {
  const budget = buildAntigravityTokenBudget({
    input_tokens: 1_200,
    cache_read_tokens: 800,
    output_tokens: 300,
    total_tokens: 2_300,
  });

  assert.deepEqual(budget, {
    used: 2_300,
    inputTokens: 2_000,
    outputTokens: 300,
    breakdown: { input: 2_000, output: 300 },
  });
});

test('usage without a total is summed from its parts', () => {
  const budget = buildAntigravityTokenBudget({ input_tokens: 10, output_tokens: 5 });

  assert.equal(budget?.used, 15);
  assert.equal(budget?.inputTokens, 10);
});

test('usage that reports nothing yields no readout at all', () => {
  // A zero budget would render as "0 tokens used", which reads as a fact about
  // the turn rather than as "the CLI did not say".
  assert.equal(buildAntigravityTokenBudget({ input_tokens: 0, output_tokens: 0 }), null);
  assert.equal(buildAntigravityTokenBudget(null), null);
  assert.equal(buildAntigravityTokenBudget('12000'), null);
  assert.equal(buildAntigravityTokenBudget(undefined), null);
});

test('unparseable usage numbers count as zero rather than NaN', () => {
  const budget = buildAntigravityTokenBudget({
    input_tokens: 'lots',
    output_tokens: 40,
    total_tokens: null,
  });

  assert.equal(budget?.used, 40);
  assert.equal(budget?.inputTokens, 0);
});

// ---------------------------------------------------------------------------
// Refusal reporting — a refused turn still exits 0, so this is the only signal
// ---------------------------------------------------------------------------

test('stderr rules are harvested whole, arguments included', () => {
  const rules = new Set<string>();
  collectGrantRuleCandidates(
    'Permission required: add command(npm run build) to allow this action.',
    rules,
  );

  assert.deepEqual([...rules], ['command(npm run build)']);
});

test('several rules on one line are all harvested, ordinary chatter is not', () => {
  const rules = new Set<string>();
  collectGrantRuleCandidates('allow read_file(/tmp/a.txt) or write_file(/tmp/a.txt)', rules);
  collectGrantRuleCandidates('Conversation using project ID: abc-123', rules);
  collectGrantRuleCandidates('running npm run build in /tmp', rules);

  assert.deepEqual([...rules], ['read_file(/tmp/a.txt)', 'write_file(/tmp/a.txt)']);
});

test('a refusal that names its own whole rule is offered as-is', () => {
  const refused = buildRefusedAction(
    { action: 'command(npm run build)', display_name: 'RunCommand' },
    new Set(),
    null,
  );

  assert.deepEqual(refused, {
    action: 'command(npm run build)',
    displayName: 'RunCommand',
    rule: 'command(npm run build)',
  });
});

test('a refusal naming only its kind is paired with the rule agy printed', () => {
  // The observed `denied_actions` shape carries the kind and a tool label but
  // never the command text, so the complete rule has to come from stderr.
  const rules = new Set(['command(npm run build)']);
  const refused = buildRefusedAction({ action: 'command', display_name: 'RunCommand' }, rules, null);

  assert.equal(refused.rule, 'command(npm run build)');
  assert.equal(refused.action, 'command');
});

test('two refusals of the same kind get two different rules', () => {
  const rules = new Set(['command(npm run build)', 'command(git push)']);

  const first = buildRefusedAction({ action: 'command' }, rules, null);
  const second = buildRefusedAction({ action: 'command' }, rules, null);

  assert.equal(first.rule, 'command(npm run build)');
  assert.equal(second.rule, 'command(git push)');
});

test('a rule of another kind is never offered for this refusal', () => {
  const rules = new Set(['read_file(/tmp/secret)']);
  const refused = buildRefusedAction({ action: 'command' }, rules, null);

  assert.equal(refused.rule, undefined);
  assert.equal(rules.has('read_file(/tmp/secret)'), true, 'the unrelated rule must stay available');
});

test('a refused command falls back to the command that was actually attempted', () => {
  const refused = buildRefusedAction({ action: 'command' }, new Set(), 'npm run build');

  assert.equal(refused.rule, 'command(npm run build)');
});

test('the stderr rule outranks the last attempted command', () => {
  const rules = new Set(['command(npm run build)']);
  const refused = buildRefusedAction({ action: 'command' }, rules, 'rm -rf /tmp/x');

  assert.equal(refused.rule, 'command(npm run build)');
});

test('a refusal whose whole action is unknown reports without offering a button', () => {
  // Matching inside `agy` is exact, so a kind-only rule would grant nothing —
  // and guessing the argument would write something the user never asked for
  // into a record the Antigravity IDE also owns.
  const readFile = buildRefusedAction({ action: 'read_file', display_name: 'ReadFile' }, new Set(), 'ls');
  assert.equal(readFile.rule, undefined);
  assert.equal(readFile.displayName, 'ReadFile');

  const unknown = buildRefusedAction({}, new Set(), null);
  assert.deepEqual(unknown, { action: 'unknown action', displayName: undefined });
});

// ---------------------------------------------------------------------------
// Command-line assembly — permission modes
// ---------------------------------------------------------------------------

test('the default permission mode passes no permission flag at all', () => {
  // Default relies on the grants already in the user's project record.
  assert.deepEqual(resolveAntigravityPermissionArgs('default'), []);
  assert.deepEqual(resolveAntigravityPermissionArgs(undefined), []);
});

test('bypassPermissions is the one escape hatch the CLI offers', () => {
  assert.deepEqual(
    resolveAntigravityPermissionArgs('bypassPermissions'),
    ['--dangerously-skip-permissions'],
  );
});

test('acceptEdits, plan and typos are rejected rather than degraded (ADR 0015)', () => {
  // `--mode accept-edits` and `--mode plan` are accepted in print mode and then
  // ignored with a warning, so passing them would only produce CLI noise — and
  // silently answering [] would run the turn with fewer grants than asked for.
  for (const mode of ['acceptEdits', 'plan', 'acceptedits', 'Plan', 'bypassPermission']) {
    assert.throws(
      () => resolveAntigravityPermissionArgs(mode),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
      `mode ${mode} must be rejected`,
    );
  }
});

// ---------------------------------------------------------------------------
// The NDJSON fold — synthetic events and a fake emit, never a live `agy`
// ---------------------------------------------------------------------------

type FoldContext = Parameters<typeof foldAntigravityEventLine>[2];
type SentMessage = Parameters<FoldContext['send']>[0];

/** Shorthand for one `step_update` envelope. */
const stepUpdate = (update: Record<string, unknown>): Record<string, unknown> => ({
  event: 'step_update',
  step_update: update,
});

/**
 * Drives the fold over a list of events and collects what it emitted.
 *
 * Objects are stringified so every case goes through the same parse the CLI's
 * output does; a raw string is passed through untouched, which is how the
 * malformed-line cases are written. `registerSession` is the caller's half of
 * session adoption — the process map and the writer belong to
 * `spawnAntigravity` — so here it only answers with the id the turn is known
 * by afterwards, which is all the fold reads back.
 */
const foldEvents = (
  events: Array<Record<string, unknown> | string>,
  options: { appSessionId?: string | null; capturedSessionId?: string | null } = {},
): { sent: SentMessage[]; state: ReturnType<typeof createAntigravityTurnState> } => {
  const sent: SentMessage[] = [];
  const context: FoldContext = {
    send: (message) => {
      sent.push(message);
    },
    registerSession: (capturedSessionId, nextSessionId) => nextSessionId || capturedSessionId,
    appSessionId: options.appSessionId === undefined ? 'app-1' : options.appSessionId,
    antigravityProjectId: 'project-abc',
    workspacePath: '/tmp/workspace',
    prompt: 'build it',
  };

  let state = createAntigravityTurnState(options.capturedSessionId ?? null);
  for (const event of events) {
    state = foldAntigravityEventLine(
      state,
      typeof event === 'string' ? event : JSON.stringify(event),
      context,
    );
  }

  return { sent, state };
};

test('assistant prose streams out fragment by fragment, in order, under one session', () => {
  const { sent } = foldEvents([
    { event: 'init', init: { conversation_id: 'conv-1' } },
    stepUpdate({ step_type: 'agent_response', step_index: 0, text_delta: 'Hello' }),
    stepUpdate({ step_type: 'agent_response', step_index: 0, text_delta: ', ' }),
    stepUpdate({ step_type: 'agent_response', step_index: 0, text_delta: 'world.' }),
  ]);

  // The runtime streams and the client concatenates, so what belongs to this
  // side is that every fragment reaches the writer exactly once, in the order
  // `agy` produced it, tagged as the same assistant turn.
  assert.deepEqual(
    sent.map((message) => message.kind),
    ['stream_delta', 'stream_delta', 'stream_delta'],
  );
  assert.equal(sent.map((message) => message.content).join(''), 'Hello, world.');
  assert.deepEqual([...new Set(sent.map((message) => message.sessionId))], ['conv-1']);
  assert.deepEqual([...new Set(sent.map((message) => message.role))], ['assistant']);
});

test('a step that carries no text of its own streams nothing', () => {
  // State-only updates would otherwise punctuate the reply with empty deltas.
  const { sent, state } = foldEvents([
    stepUpdate({ step_type: 'agent_response', step_index: 0, state: 'ACTIVE' }),
    stepUpdate({
      step_type: 'agent_response',
      step_index: 0,
      text_delta: '',
      usage: { input_tokens: 7, output_tokens: 3 },
    }),
  ]);

  assert.deepEqual(sent, []);
  // The usage it reported is still carried forward by the turn state.
  assert.deepEqual(state.latestStepUsage, { input_tokens: 7, output_tokens: 3 });
});

test('ACTIVE and DONE for one step land on a single tool card', () => {
  const { sent } = foldEvents([
    { event: 'init', init: { conversation_id: 'conv-2' } },
    stepUpdate({
      step_type: 'tool',
      step_index: 0,
      state: 'ACTIVE',
      tool_name: 'RunCommand',
      tool_info: { command: 'npm run build' },
    }),
    stepUpdate({
      step_type: 'tool',
      step_index: 0,
      state: 'DONE',
      tool_name: 'RunCommand',
      tool_info: { command: 'npm run build', output: 'built in 3s' },
    }),
  ]);

  const [active, done] = sent;
  // One id for both emissions is what makes the UI update the card it already
  // rendered instead of stacking a second one underneath it.
  assert.equal(active.id, 'antigravity-tool-conv-2-0');
  assert.equal(done.id, active.id);
  assert.equal(active.toolResult, undefined);
  assert.deepEqual(done.toolResult, { content: 'built in 3s' });
  assert.deepEqual([active.kind, done.kind], ['tool_use', 'tool_use']);
});

test('a second step gets a card of its own', () => {
  const { sent } = foldEvents(
    [
      stepUpdate({ step_type: 'tool', step_index: 0, state: 'ACTIVE', tool_name: 'ReadFile' }),
      stepUpdate({ step_type: 'tool', step_index: 1, state: 'ACTIVE', tool_name: 'WriteFile' }),
    ],
    // No conversation id announced yet and no app session either, so the id
    // falls all the way back to `run`.
    { appSessionId: null },
  );

  assert.deepEqual(
    sent.map((message) => message.id),
    ['antigravity-tool-run-0', 'antigravity-tool-run-1'],
  );
  assert.deepEqual(
    sent.map((message) => message.toolId),
    ['antigravity-tool-0', 'antigravity-tool-1'],
  );
});

test('an unseen step type still renders what it said', () => {
  const { sent } = foldEvents([
    stepUpdate({ step_type: 'system_message', step_index: 0, text_delta: 'Reading the repository.' }),
    stepUpdate({ step_type: 'plan_draft', step_index: 1, text_delta: 'Thinking about the layout.' }),
    stepUpdate({ step_index: 2, text_delta: 'No step type at all.' }),
    stepUpdate({ step_type: 'user_input', step_index: 3, text_delta: 'build it' }),
  ]);

  // Only `user_input` is suppressed, because the client already renders its own
  // bubble for it. Everything else — documented, observed, or added by a future
  // release — falls through to the text path rather than being dropped.
  assert.deepEqual(
    sent.map((message) => message.content),
    ['Reading the repository.', 'Thinking about the layout.', 'No step type at all.'],
  );
});

test('a truncated final line is streamed verbatim rather than dropped', () => {
  const truncated = '{"event":"step_update","step_update":{"text_delta":"half a th';
  const { sent } = foldEvents([
    { event: 'init', init: { conversation_id: 'conv-3' } },
    truncated,
  ]);

  // A process killed mid-write leaves one unterminated line. Showing it beats
  // swallowing it: a change in the CLI's output shape still reaches the user.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'stream_delta');
  assert.equal(sent[0].content, truncated);
  assert.equal(sent[0].sessionId, 'conv-3');
  // Not marked as assistant prose — all that is known is that it went unparsed.
  assert.equal(sent[0].role, undefined);
});

test('blank lines and JSON that is not an event are skipped in silence', () => {
  // These parse, so they are not CLI output that failed to be an event — they
  // simply are not events, and echoing them would be transcript noise.
  const { sent } = foldEvents(['', '   ', 'null', '[1,2]', '42']);

  assert.deepEqual(sent, []);
});

test('one turn threads its state from the first line to the terminal complete', () => {
  const { sent, state } = foldEvents([
    { event: 'init', init: { conversation_id: 'conv-4' } },
    stepUpdate({
      step_type: 'tool',
      step_index: 0,
      state: 'DONE',
      tool_name: 'RunCommand',
      tool_info: { command: 'npm run build' },
      usage: { input_tokens: 100, output_tokens: 20 },
    }),
    { event: 'result', result: { status: 'SUCCESS', denied_actions: [{ action: 'command' }] } },
  ]);

  // Every field of the fold's state is read back by the `result` line: the
  // usage bills the turn, the attempted command names the refusal's rule, and
  // the complete flag is what holds a run to exactly one terminal message.
  const [, refusal, budget, complete] = sent;
  assert.match(String(refusal.content), /^Antigravity refused this action: command\./);
  assert.equal(budget.text, 'token_budget');
  assert.deepEqual(budget.tokenBudget, {
    used: 120,
    inputTokens: 100,
    outputTokens: 20,
    breakdown: { input: 100, output: 20 },
  });
  assert.equal(complete.kind, 'complete');
  assert.equal(complete.sessionId, 'conv-4');
  assert.equal(state.completeSent, true);
  assert.equal(state.lastAttemptedCommand, 'npm run build');
});

// ---------------------------------------------------------------------------
// Command-line assembly — the always-present and never-passed flag matrix
// ---------------------------------------------------------------------------

type ArgsInput = Parameters<typeof buildAntigravityArgs>[0];

const baseArgsInput: ArgsInput = {
  command: 'build it',
  antigravityProjectId: 'project-abc',
};

test('a plain turn carries the flags the runtime cannot work without', () => {
  assert.deepEqual(buildAntigravityArgs(baseArgsInput), [
    '-p',
    'build it',
    '--output-format',
    'stream-json',
    '--project',
    'project-abc',
  ]);
});

const argumentMatrix: Array<{
  name: string;
  input: ArgsInput;
  present?: Array<[string, string]>;
  absent?: string[];
}> = [
  {
    name: 'a resume names the conversation it continues',
    input: { ...baseArgsInput, providerSessionId: 'conv-7' },
    present: [['--conversation', 'conv-7']],
  },
  {
    name: 'a first turn has no conversation to resume',
    input: { ...baseArgsInput, providerSessionId: null },
    absent: ['--conversation'],
  },
  {
    name: 'a resolved model overrides whatever the CLI would have picked',
    input: { ...baseArgsInput, resolvedModel: 'gemini-3-pro' },
    present: [['--model', 'gemini-3-pro']],
  },
  {
    name: 'no resolved model leaves the choice to the CLI',
    input: { ...baseArgsInput, resolvedModel: undefined },
    absent: ['--model'],
  },
  {
    name: 'a project path is added as a workspace directory',
    input: { ...baseArgsInput, projectPath: '/tmp/workspace' },
    present: [['--add-dir', '/tmp/workspace']],
  },
  {
    name: 'no project path means there is nothing to add',
    input: { ...baseArgsInput, projectPath: null },
    absent: ['--add-dir'],
  },
  {
    name: 'bypassPermissions is the one mode that reaches the command line',
    input: { ...baseArgsInput, permissionMode: 'bypassPermissions' },
    present: [['--dangerously-skip-permissions', undefined as unknown as string]],
  },
  {
    name: 'the default mode relies on the project record alone',
    input: { ...baseArgsInput, permissionMode: 'default' },
    absent: ['--dangerously-skip-permissions'],
  },
  {
    name: 'an unstated mode is a caller not choosing, not a caller choosing bypass',
    input: { ...baseArgsInput, permissionMode: undefined },
    absent: ['--dangerously-skip-permissions'],
  },
  {
    name: 'every conditional flag at once',
    input: {
      ...baseArgsInput,
      projectPath: '/tmp/workspace',
      providerSessionId: 'conv-7',
      resolvedModel: 'gemini-3-pro',
      permissionMode: 'bypassPermissions',
    },
    present: [
      ['--add-dir', '/tmp/workspace'],
      ['--conversation', 'conv-7'],
      ['--model', 'gemini-3-pro'],
      // Value-less, and last: nothing may follow it.
      ['--dangerously-skip-permissions', undefined as unknown as string],
    ],
  },
];

for (const row of argumentMatrix) {
  test(`command line: ${row.name}`, () => {
    const args = buildAntigravityArgs(row.input);

    for (const [flag, value] of row.present ?? []) {
      const index = args.indexOf(flag);
      assert.notEqual(index, -1, `${flag} must be passed`);
      // The bypass flag takes no value, so its rows pin `undefined` — nothing
      // follows it on the command line.
      assert.equal(args[index + 1], value, `${flag} must be followed by ${value}`);
    }

    for (const flag of row.absent ?? []) {
      assert.equal(args.includes(flag), false, `${flag} must not be passed`);
    }

    // Always, whatever else the row asks for: headless print mode, the NDJSON
    // the fold reads, and the project a permission grant would apply in.
    assert.equal(args[0], '-p');
    assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
    assert.equal(args[args.indexOf('--project') + 1], 'project-abc');
  });
}

test('an attachment-only message still sends a prompt', () => {
  // stream-json input accepts text blocks only, so attachments ride along
  // inside the prompt rather than as a block of their own.
  const args = buildAntigravityArgs({
    ...baseArgsInput,
    command: '   ',
    images: ['/tmp/assets/shot.png'],
  });

  assert.equal(args[0], '-p');
  assert.match(args[1], /<images_input>/);
  assert.match(args[1], /\/tmp\/assets\/shot\.png/);
});

test('a turn with nothing to say passes no prompt at all', () => {
  assert.deepEqual(buildAntigravityArgs({ ...baseArgsInput, command: '   ' }), [
    '-p',
    '--output-format',
    'stream-json',
    '--project',
    'project-abc',
  ]);
});

test('the command line refuses a permission mode the CLI cannot honour', () => {
  // The builder derives its flags from the same helper `spawnAntigravity`
  // validates with, so a bad mode cannot reach `agy` through this path either.
  assert.throws(
    () => buildAntigravityArgs({ ...baseArgsInput, permissionMode: 'plan' }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});
