import assert from 'node:assert/strict';

import { test } from 'vitest';

import { withCompactCommand } from '@/modules/chat/utils/compactCommand';

const fetched = [
  { name: '/help', type: 'built-in' },
  { name: '/cost', type: 'built-in' },
];

const options = { description: 'Free up context', usage: {} as Record<string, number> };

test('offers Compact when the provider supports it', () => {
  const commands = withCompactCommand(fetched, { ...options, supported: true });
  const compact = commands.find((command) => command.name === '/compact');

  assert.ok(compact, 'Compact should be offered');
  // Must not be routed through the backend command endpoint: the composer
  // exempts this type from interception so it reaches the provider verbatim.
  assert.equal(compact?.type, 'compact');
  assert.equal(compact?.description, 'Free up context');
});

test('withholds Compact when the provider cannot run it', () => {
  const commands = withCompactCommand(fetched, { ...options, supported: false });

  assert.equal(commands.find((command) => command.name === '/compact'), undefined);
  assert.deepEqual(commands, fetched, 'the fetched list should be returned untouched');
});

test('withholds Compact before the capability has loaded', () => {
  // The capability resolves to false until /api/providers/capabilities answers,
  // so an unsupported provider never briefly sees a dead entry.
  const commands = withCompactCommand(fetched, { ...options, supported: false });

  assert.equal(commands.length, fetched.length);
});

test('sorts Compact by usage like any other command', () => {
  const commands = withCompactCommand(fetched, {
    ...options,
    supported: true,
    usage: { '/compact': 5, '/help': 1 },
  });

  assert.equal(commands[0]?.name, '/compact');
});

test('does not add a second entry when one is already present', () => {
  const once = withCompactCommand(fetched, { ...options, supported: true });
  const twice = withCompactCommand(once, { ...options, supported: true });

  assert.equal(twice.filter((command) => command.name === '/compact').length, 1);
});
