import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  buildClearedSessionName,
  sessionClearService,
} from '@/modules/providers/services/session-clear.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-clear-db-'));

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

// Seam: the fixed English prefix the retired conversation's title gains. It is
// a literal written into the name -- not a translated string and not a rendered
// badge -- so it survives a language switch and the sidebar's inline rename can
// edit it afterwards.

test('a retired conversation keeps its own name behind the prefix', () => {
  assert.equal(buildClearedSessionName('Wire up the sidebar'), '[Cleared] Wire up the sidebar');
});

test('an unnamed session still produces a readable name', () => {
  assert.equal(buildClearedSessionName(''), '[Cleared] Untitled Session');
  assert.equal(buildClearedSessionName('   '), '[Cleared] Untitled Session');
});

test('surrounding whitespace is not carried into the prefixed name', () => {
  assert.equal(buildClearedSessionName('  Retry  '), '[Cleared] Retry');
});

test('clearing an already cleared session nests rather than replacing the prefix', () => {
  // The same rule buildForkSessionName follows: the prefix records that a
  // Clear happened, so a second one stays visible instead of being swallowed.
  assert.equal(buildClearedSessionName('[Cleared] Retry'), '[Cleared] [Cleared] Retry');
});

test('Clear retires the open conversation and opens an empty one beside it', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('open-session', 'claude', '/workspace/demo', 'Wire up the sidebar');
    sessionsDb.assignProviderSessionId('open-session', 'claude-native-1');
    sessionsDb.setSessionModel('open-session', 'opus');
    sessionsDb.setSessionEffort('open-session', 'high');

    const result = sessionClearService.clearSession('open-session');

    const retired = sessionsDb.getSessionById('open-session');
    assert.equal(retired?.isArchived, 1);
    assert.equal(retired?.custom_name, '[Cleared] Wire up the sidebar');
    // Nothing is emptied or deleted: the retired conversation keeps the
    // provider session it was written against and stays resumable.
    assert.equal(retired?.provider_session_id, 'claude-native-1');

    const opened = sessionsDb.getSessionById(result.sessionId);
    assert.ok(opened, 'Clear should have opened a new session');
    assert.equal(opened?.isArchived, 0);
    assert.equal(opened?.project_path, retired?.project_path);
    assert.equal(opened?.provider, 'claude');
    // App-session shape (session_id <> provider_session_id) with no name yet:
    // the title derived from the first message must be free to land, which the
    // session upsert's custom_name CASE would block if a name were written now.
    assert.equal(opened?.provider_session_id, null);
    assert.equal(opened?.custom_name, null);
    // The reader carries on with the same runtime configuration.
    assert.equal(opened?.model, 'opus');
    assert.equal(opened?.effort, 'high');
  });
});

test('Clear is refused for a provider that does not report it', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('codex-session', 'codex', '/workspace/demo', 'Fix the login redirect');

    assert.throws(
      () => sessionClearService.clearSession('codex-session'),
      /cannot clear a session/i,
    );
    assert.equal(sessionsDb.getSessionById('codex-session')?.isArchived, 0);
  });
});

test('Clear reports an unknown session rather than opening one', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    assert.throws(() => sessionClearService.clearSession('missing-session'), /was not found/);
  });
});
