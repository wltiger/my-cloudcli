import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withClearCommand } from './clearCommand';

const fetched = [
  { name: '/help', type: 'built-in' },
  { name: '/cost', type: 'built-in' },
];

const options = { description: 'Start a fresh conversation', usage: {} as Record<string, number> };

test('offers Clear when the provider supports it', () => {
  const commands = withClearCommand(fetched, { ...options, supported: true });
  const clear = commands.find((command) => command.name === '/clear');

  assert.ok(clear, 'Clear should be offered');
  // Its own type, not Compact's: Clear is a CloudCLI-side action, so the
  // composer must intercept it instead of letting it reach the provider.
  assert.equal(clear?.type, 'clear');
  assert.equal(clear?.description, 'Start a fresh conversation');
});

test('withholds Clear when the provider does not report it', () => {
  const commands = withClearCommand(fetched, { ...options, supported: false });

  assert.equal(commands.find((command) => command.name === '/clear'), undefined);
  assert.deepEqual(commands, fetched, 'the fetched list should be returned untouched');
});

test('withholds Clear before the capability has loaded', () => {
  // The capability resolves to false until /api/providers/capabilities answers,
  // so an unsupported provider never briefly sees a dead entry.
  const commands = withClearCommand(fetched, { ...options, supported: false });

  assert.equal(commands.length, fetched.length);
});

test('sorts Clear by usage like any other command', () => {
  const commands = withClearCommand(fetched, {
    ...options,
    supported: true,
    usage: { '/clear': 5, '/help': 1 },
  });

  assert.equal(commands[0]?.name, '/clear');
});

test('does not add a second entry when one is already present', () => {
  const once = withClearCommand(fetched, { ...options, supported: true });
  const twice = withClearCommand(once, { ...options, supported: true });

  assert.equal(twice.filter((command) => command.name === '/clear').length, 1);
});

test('leaves a project command that already owns the name alone', () => {
  // A user-authored /clear in .claude/commands wins: replacing it would take
  // away a command the reader wrote on purpose.
  const withCustom = [...fetched, { name: '/clear', type: 'custom' }];
  const commands = withClearCommand(withCustom, { ...options, supported: true });

  assert.deepEqual(commands, withCustom);
});
