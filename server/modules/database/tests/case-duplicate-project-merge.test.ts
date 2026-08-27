import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'case-duplicate-project-merge-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
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

/**
 * Seeds a `projects` row (and optional sessions) with a raw path, bypassing
 * `normalizeProjectPath`, to reproduce legacy pre-fix data where the same
 * directory was indexed twice under different drive-letter casing.
 */
function seedLegacyProject(
  projectId: string,
  projectPath: string,
  overrides: { customProjectName?: string | null; isStarred?: number; isArchived?: number } = {}
): void {
  const db = getConnection();
  db.prepare(`
    INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    projectId,
    projectPath,
    overrides.customProjectName ?? null,
    overrides.isStarred ?? 0,
    overrides.isArchived ?? 0
  );
}

function seedLegacySession(sessionId: string, provider: string, projectPath: string): void {
  const db = getConnection();
  db.prepare(`
    INSERT INTO sessions (session_id, provider, provider_session_id, project_path, isArchived)
    VALUES (?, ?, ?, ?, 0)
  `).run(sessionId, provider, sessionId, projectPath);
}

test('runMigrations merges projects that differ only by Windows path casing', async () => {
  await withIsolatedDatabase(() => {
    seedLegacyProject('project-lower', 'd:\\code\\opensource\\claudecodeui', {
      customProjectName: 'claudecodeui',
    });
    seedLegacyProject('project-upper', 'D:\\code\\opensource\\claudecodeui');
    seedLegacySession('claude-session-1', 'claude', 'd:\\code\\opensource\\claudecodeui');
    seedLegacySession('opencode-session-1', 'opencode', 'D:\\code\\opensource\\claudecodeui');

    runMigrations(getConnection());

    const canonicalPath = 'd:\\code\\opensource\\claudecodeui';
    const remaining = projectsDb.getProjectPaths().filter((row) => row.project_path.toLowerCase() === canonicalPath);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].project_path, canonicalPath);
    assert.equal(remaining[0].custom_project_name, 'claudecodeui');

    const sessions = sessionsDb.getSessionsByProjectPath(canonicalPath);
    const sessionIds = sessions.map((session) => session.session_id).sort();
    assert.deepEqual(sessionIds, ['claude-session-1', 'opencode-session-1']);
  });
});

test('runMigrations keeps the starred/active state when merging case-duplicate projects', async () => {
  await withIsolatedDatabase(() => {
    seedLegacyProject('project-archived', 'D:\\code\\starred-project', {
      isStarred: 1,
      isArchived: 1,
    });
    seedLegacyProject('project-active', 'd:\\code\\starred-project', {
      isStarred: 0,
      isArchived: 0,
    });

    runMigrations(getConnection());

    const merged = projectsDb.getProjectPath('d:\\code\\starred-project');
    assert.ok(merged);
    assert.equal(merged?.isStarred, 1);
    assert.equal(merged?.isArchived, 0);
  });
});

test('runMigrations leaves distinct (non-case-variant) project paths alone', async () => {
  await withIsolatedDatabase(() => {
    seedLegacyProject('project-a', 'd:\\code\\project-a');
    seedLegacyProject('project-b', 'd:\\code\\project-b');

    runMigrations(getConnection());

    assert.equal(projectsDb.getProjectPath('d:\\code\\project-a')?.project_id, 'project-a');
    assert.equal(projectsDb.getProjectPath('d:\\code\\project-b')?.project_id, 'project-b');
    assert.equal(projectsDb.getProjectPaths().length, 2);
  });
});
