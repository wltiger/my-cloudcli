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
  buildAntigravityTokenBudget,
  buildRefusedAction,
  collectGrantRuleCandidates,
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

test('acceptEdits and plan never reach the command line (ADR 0015)', () => {
  // `--mode accept-edits` and `--mode plan` are accepted in print mode and then
  // ignored with a warning, so passing them would only produce CLI noise.
  for (const mode of ['acceptEdits', 'plan', 'acceptedits', 'Plan']) {
    assert.deepEqual(resolveAntigravityPermissionArgs(mode), [], `mode ${mode} must add no flag`);
  }
});
