import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import {
  buildForkSessionName,
  sessionForkService,
} from '@/modules/providers/services/session-fork.service.js';
import type { IProviderSessions } from '@/shared/interfaces.js';

/**
 * Replaces Claude's own fork with one that copies nothing.
 *
 * The provider half is covered where it lives; what these tests are about is
 * CloudCLI's side of a Fork. `forkSession` is optional on the facet -- a
 * provider that cannot branch a session simply omits it -- so it has to be
 * narrowed before node:test will replace it.
 */
function mockClaudeForkSession(forkedProviderSessionId: string) {
  const claudeSessions = providerRegistry.resolveProvider('claude').sessions as Required<IProviderSessions>;
  return mock.method(claudeSessions, 'forkSession', async () => forkedProviderSessionId);
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-fork-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

// Seam: this is the name the Fork dialog opens pre-filled with. The reader can
// still edit it, so these only pin the starting point.

test('a fork is named after the session it came from', () => {
  assert.equal(buildForkSessionName('Wire up the sidebar', []), '[Fork] Wire up the sidebar');
});

test('an already-taken name gets a sequence number', () => {
  assert.equal(
    buildForkSessionName('Wire up the sidebar', ['Wire up the sidebar', '[Fork] Wire up the sidebar']),
    '[Fork] Wire up the sidebar (2)',
  );
});

test('the sequence continues past every taken number', () => {
  assert.equal(
    buildForkSessionName('Retry', ['[Fork] Retry', '[Fork] Retry (2)', '[Fork] Retry (3)']),
    '[Fork] Retry (4)',
  );
});

test('a gap in the sequence is filled rather than skipped', () => {
  assert.equal(
    buildForkSessionName('Retry', ['[Fork] Retry', '[Fork] Retry (3)']),
    '[Fork] Retry (2)',
  );
});

test('forking a fork nests rather than replacing the prefix', () => {
  assert.equal(buildForkSessionName('[Fork] Retry', []), '[Fork] [Fork] Retry');
});

test('an unnamed session still produces a usable name', () => {
  assert.equal(buildForkSessionName('', []), '[Fork] Untitled Session');
  assert.equal(buildForkSessionName('   ', []), '[Fork] Untitled Session');
});

test('surrounding whitespace never makes a taken name look free', () => {
  assert.equal(
    buildForkSessionName('  Retry  ', ['  [Fork] Retry  ']),
    '[Fork] Retry (2)',
  );
});

test('the suggested name treats one taken by an archived session as taken', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('source-session', 'claude', '/workspace/demo', 'Retry');
    sessionsDb.createAppSession('earlier-fork', 'claude', '/workspace/demo', '[Fork] Retry');
    sessionsDb.updateSessionIsArchived('earlier-fork', true);

    // Deliberate: archiving hides a session, it does not release its name, and
    // any activity brings it straight back into the list. Scanning archived
    // sessions too is what stops a fork colliding with one that reappears.
    assert.equal(
      sessionForkService.suggestForkName('source-session').suggestedName,
      '[Fork] Retry (2)',
    );
  });
});

test('Fork registers the copy as a new session beside the original', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = path.join(os.tmpdir(), 'fork-workspace');
    const sourceTranscript = path.join(projectPath, 'claude-native-1.jsonl');

    sessionsDb.createAppSession('source-session', 'claude', projectPath, 'Wire up the sidebar');
    sessionsDb.assignProviderSessionId('source-session', 'claude-native-1');
    // What the sessions watcher does once the provider has written the file.
    sessionsDb.createSession(
      'claude-native-1',
      'claude',
      projectPath,
      undefined,
      undefined,
      undefined,
      sourceTranscript,
    );
    sessionsDb.setSessionModel('source-session', 'opus');
    sessionsDb.setSessionEffort('source-session', 'high');

    const forkSessionMock = mockClaudeForkSession('claude-native-2');

    try {
      const result = await sessionForkService.forkSession(
        'source-session',
        'anchor-uuid',
        '  [Fork] Wire up the sidebar  ',
      );

      // The provider owns the copy and is handed the provider-native id, never
      // the app-facing one it has never seen.
      const forkOptions = forkSessionMock.mock.calls[0]?.arguments[0];
      assert.equal(forkOptions?.providerSessionId, 'claude-native-1');
      assert.equal(forkOptions?.anchor, 'anchor-uuid');
      assert.equal(forkOptions?.title, '[Fork] Wire up the sidebar');

      const forked = sessionsDb.getSessionById(result.sessionId);
      assert.ok(forked, 'Fork should have registered a new session');
      assert.notEqual(result.sessionId, 'source-session');
      assert.equal(result.sessionName, '[Fork] Wire up the sidebar');
      assert.equal(result.provider, 'claude');
      // App-session shape (session_id <> provider_session_id) mapped onto the
      // copy the provider just wrote: createAppSession then
      // assignProviderSessionId.
      assert.equal(forked?.custom_name, '[Fork] Wire up the sidebar');
      assert.equal(forked?.provider_session_id, 'claude-native-2');
      assert.notEqual(forked?.session_id, forked?.provider_session_id);
      // ...and createSession indexes the fork's transcript immediately, next to
      // the original, so it opens with its history instead of looking empty
      // until the watcher's next pass.
      assert.equal(
        forked?.jsonl_path,
        path.join(path.dirname(sourceTranscript), 'claude-native-2.jsonl'),
      );
      // The reader carries on with the same runtime configuration.
      assert.equal(forked?.model, 'opus');
      assert.equal(forked?.effort, 'high');

      // The original is left untouched and still resumable.
      const source = sessionsDb.getSessionById('source-session');
      assert.equal(source?.provider_session_id, 'claude-native-1');
      assert.equal(source?.custom_name, 'Wire up the sidebar');
      assert.equal(source?.isArchived, 0);
    } finally {
      forkSessionMock.mock.restore();
    }
  });
});

test('an empty name falls back to the suggested one rather than an unnamed fork', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('source-session', 'claude', '/workspace/demo', 'Retry');
    sessionsDb.assignProviderSessionId('source-session', 'claude-native-1');

    const forkSessionMock = mockClaudeForkSession('claude-native-2');

    try {
      const result = await sessionForkService.forkSession('source-session', 'anchor-uuid', '   ');
      assert.equal(result.sessionName, '[Fork] Retry');
    } finally {
      forkSessionMock.mock.restore();
    }
  });
});

test('Fork is refused for a provider that cannot branch a session', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('codex-session', 'codex', '/workspace/demo', 'Fix the login redirect');
    sessionsDb.assignProviderSessionId('codex-session', 'codex-native-1');

    // The capability is the provider's own `forkSession` facet method being
    // absent, not a flag beside it -- there is nothing to call.
    await assert.rejects(
      () => sessionForkService.forkSession('codex-session', 'anchor-uuid', 'A fork'),
      /cannot fork a session/i,
    );
  });
});

test('Fork is refused before the session has ever been started', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('unstarted-session', 'claude', '/workspace/demo', 'Nothing sent yet');

    // No provider_session_id means the provider has never seen this session,
    // so there is no transcript to copy.
    await assert.rejects(
      () => sessionForkService.forkSession('unstarted-session', 'anchor-uuid', 'A fork'),
      /has not been started yet/i,
    );

    const projectPath = sessionsDb.getSessionById('unstarted-session')?.project_path ?? '';
    assert.equal(sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath).length, 1);
  });
});

test('Fork reports an unknown session rather than registering one', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    await assert.rejects(
      () => sessionForkService.forkSession('missing-session', 'anchor-uuid', 'A fork'),
      /was not found/,
    );
  });
});
