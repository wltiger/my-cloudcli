/**
 * OpenCode session pruning, against a real `opencode.db` under a temporary home
 * and a throwaway CloudCLI database.
 *
 * Deleting a session in OpenCode removes its `session` row from the shared
 * database and nothing else CloudCLI could notice: the index rows carry no
 * transcript path, so the generic orphan prune never sees them. What these
 * tests pin is which CloudCLI rows the synchronizer drops on its own, and the
 * ones it must never touch.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { OpenCodeSessionSynchronizer } from '@/modules/providers/list/opencode/opencode-session-synchronizer.provider.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

/** One OpenCode `session` row, defaulted to a plain active session. */
type OpenCodeSession = {
  id: string;
  title?: string;
  /** Set when the user archived the session inside OpenCode. */
  time_archived?: number | null;
};

type Fixture = {
  /**
   * What sits at `opencode.db`: a real database with these sessions, nothing,
   * or a sqlite file with no `session` table (any read of it fails).
   */
  database: OpenCodeSession[] | 'missing' | 'no-session-table';
};

const WORKSPACE_PATH = 'D:/code/demo';
const OTHER_WORKSPACE_PATH = 'D:/code/other';
const SESSION_TIME = 1_700_000_000_000;
/** A CloudCLI timestamp no older than the session times above. */
const SESSION_TIMESTAMP = new Date(SESSION_TIME).toISOString();

/**
 * Lays out `opencode.db` under a throwaway home, points the app database at a
 * temp file, and runs the body.
 */
async function withOpenCode(
  fixture: Fixture,
  run: (context: {
    synchronizer: OpenCodeSessionSynchronizer;
    databasePath: string;
    deleteSession: (sessionId: string) => void;
  }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-sync-'));
  const homeDir = path.join(tempRoot, 'home');
  const dataDir = path.join(homeDir, '.local', 'share', 'opencode');
  await fs.mkdir(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, 'opencode.db');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  await fs.writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();

  if (fixture.database === 'no-session-table') {
    const db = new Database(databasePath);
    db.exec('CREATE TABLE unrelated (id TEXT)');
    db.close();
  } else if (Array.isArray(fixture.database)) {
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        worktree TEXT NOT NULL
      );
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        directory TEXT NOT NULL,
        title TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        time_archived INTEGER
      );
    `);
    db.prepare('INSERT INTO project (id, worktree) VALUES (?, ?)').run('project-1', WORKSPACE_PATH);
    const insert = db.prepare(`
      INSERT INTO session (id, project_id, directory, title, time_created, time_updated, time_archived)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const session of fixture.database) {
      insert.run(
        session.id,
        'project-1',
        WORKSPACE_PATH,
        session.title ?? session.id,
        SESSION_TIME,
        SESSION_TIME,
        session.time_archived ?? null,
      );
    }
    db.close();
  }

  const restoreHomeDir = patchHomeDir(homeDir);

  try {
    await run({
      synchronizer: new OpenCodeSessionSynchronizer(),
      databasePath,
      // What `opencode session delete <id>` leaves behind: the row is gone.
      deleteSession: (sessionId) => {
        const db = new Database(databasePath);
        db.prepare('DELETE FROM session WHERE id = ?').run(sessionId);
        db.close();
      },
    });
  } finally {
    restoreHomeDir();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/** A CloudCLI row for an OpenCode session id, as an earlier scan would have filed it. */
const indexSession = (sessionId: string, provider = 'opencode'): void => {
  sessionsDb.createSession(sessionId, provider, WORKSPACE_PATH, sessionId, SESSION_TIMESTAMP, SESSION_TIMESTAMP, null);
};

test('a session deleted in OpenCode leaves the list, and one still there stays', { concurrency: false }, async () => {
  await withOpenCode({
    database: [{ id: 'oc-kept' }, { id: 'oc-gone' }],
  }, async ({ synchronizer, deleteSession }) => {
    assert.equal(await synchronizer.synchronize(), 2);

    deleteSession('oc-gone');
    assert.equal(await synchronizer.synchronize(), 1);

    assert.ok(sessionsDb.getSessionByProviderSessionId('oc-kept'));
    assert.equal(sessionsDb.getSessionByProviderSessionId('oc-gone'), null);
  });
});

test('an archived CloudCLI row of a deleted session is pruned too', { concurrency: false }, async () => {
  await withOpenCode({
    database: [{ id: 'oc-archived' }],
  }, async ({ synchronizer, deleteSession }) => {
    await synchronizer.synchronize();
    sessionsDb.updateSessionIsArchived(sessionsDb.getSessionByProviderSessionId('oc-archived')!.session_id, true);

    deleteSession('oc-archived');
    await synchronizer.synchronize();

    assert.equal(sessionsDb.getSessionByProviderSessionId('oc-archived'), null);
  });
});

test('a session archived inside OpenCode is not mistaken for a deleted one', { concurrency: false }, async () => {
  // The upsert skips archived sessions; the prune must still count them.
  await withOpenCode({
    database: [{ id: 'oc-archived', time_archived: SESSION_TIME }],
  }, async ({ synchronizer }) => {
    indexSession('oc-archived');

    assert.equal(await synchronizer.synchronize(), 0);

    assert.ok(sessionsDb.getSessionByProviderSessionId('oc-archived'));
  });
});

test('a pending app session OpenCode does not know yet is not pruned', { concurrency: false }, async () => {
  // Its own project, so no OpenCode session binds it during the scan.
  await withOpenCode({
    database: [{ id: 'oc-a' }],
  }, async ({ synchronizer }) => {
    sessionsDb.createAppSession('app-pending', 'opencode', OTHER_WORKSPACE_PATH, 'first words');

    await synchronizer.synchronize();

    const pending = sessionsDb.getSessionById('app-pending');
    assert.ok(pending);
    assert.equal(pending.provider_session_id, null);
  });
});

test('a session running in CloudCLI is not pruned before OpenCode commits it', { concurrency: false }, async () => {
  // The runtime maps the provider id as soon as OpenCode reports it, which can
  // be before the session row is visible to a reader.
  await withOpenCode({
    database: [],
  }, async ({ synchronizer, databasePath }) => {
    sessionsDb.createAppSession('app-live', 'opencode', OTHER_WORKSPACE_PATH, 'working');
    sessionsDb.assignProviderSessionId('app-live', 'oc-live');
    // Newer than the row, so the time guard does not cover for the run guard.
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await fs.utimes(databasePath, future, future);
    chatRunRegistry.startRun({
      appSessionId: 'app-live',
      provider: 'opencode',
      providerSessionId: 'oc-live',
      connection: null,
      userId: null,
    });

    await synchronizer.synchronize();

    assert.ok(sessionsDb.getSessionById('app-live'));
  });
});

test('a row newer than the OpenCode database is not judged by it', { concurrency: false }, async () => {
  // OpenCode writing elsewhere (e.g. under XDG_DATA_HOME) leaves the database
  // read here stale; a row CloudCLI touched since must survive it.
  await withOpenCode({
    database: [{ id: 'oc-other' }],
  }, async ({ synchronizer, databasePath }) => {
    const past = new Date('2020-01-01T00:00:00Z');
    await fs.utimes(databasePath, past, past);
    indexSession('oc-elsewhere');

    await synchronizer.synchronize();

    assert.ok(sessionsDb.getSessionByProviderSessionId('oc-elsewhere'));

    // OpenCode writes through its WAL, which can be newer than the main file;
    // once it is newer than the row, the snapshot does judge it.
    await fs.writeFile(`${databasePath}-wal`, '');
    await synchronizer.synchronize();

    assert.equal(sessionsDb.getSessionByProviderSessionId('oc-elsewhere'), null);
  });
});

test('a scan with a cursor still prunes against every OpenCode session', { concurrency: false }, async () => {
  await withOpenCode({
    database: [{ id: 'oc-kept' }],
  }, async ({ synchronizer }) => {
    indexSession('oc-kept');
    indexSession('oc-gone');

    // Neither session moved since the cursor, so neither is upserted.
    assert.equal(await synchronizer.synchronize(new Date('2099-01-01T00:00:00Z')), 0);

    assert.ok(sessionsDb.getSessionByProviderSessionId('oc-kept'));
    assert.equal(sessionsDb.getSessionByProviderSessionId('oc-gone'), null);
  });
});

test('rows of other providers are never touched', { concurrency: false }, async () => {
  await withOpenCode({
    database: [],
  }, async ({ synchronizer }) => {
    indexSession('claude-a', 'claude');
    indexSession('codex-a', 'codex');
    indexSession('oc-gone');

    await synchronizer.synchronize();

    assert.ok(sessionsDb.getSessionById('claude-a'));
    assert.ok(sessionsDb.getSessionById('codex-a'));
    assert.equal(sessionsDb.getSessionByProviderSessionId('oc-gone'), null);
  });
});

test('without an OpenCode database nothing is pruned', { concurrency: false }, async () => {
  await withOpenCode({ database: 'missing' }, async ({ synchronizer }) => {
    indexSession('oc-a');

    assert.equal(await synchronizer.synchronize(), 0);

    assert.ok(sessionsDb.getSessionByProviderSessionId('oc-a'));
  });
});

test('an unreadable OpenCode database skips the prune instead of emptying the list', { concurrency: false }, async () => {
  await withOpenCode({ database: 'no-session-table' }, async ({ synchronizer }) => {
    indexSession('oc-a');

    assert.equal(await synchronizer.synchronize(), 0);

    assert.ok(sessionsDb.getSessionByProviderSessionId('oc-a'));
  });
});

test('a watcher event indexes but does not prune', { concurrency: false }, async () => {
  await withOpenCode({
    database: [{ id: 'oc-kept' }],
  }, async ({ synchronizer, databasePath }) => {
    indexSession('oc-gone');

    assert.equal(await synchronizer.synchronizeFile(databasePath), 'oc-kept');

    assert.ok(sessionsDb.getSessionByProviderSessionId('oc-gone'));
  });
});
