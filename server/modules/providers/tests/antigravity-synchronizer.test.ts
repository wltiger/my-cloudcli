/**
 * Antigravity session indexing, against a real `conversation_summaries.db`
 * under a temporary home and a throwaway CloudCLI database.
 *
 * The index is the file the Antigravity IDE writes its own sidebar state into,
 * so what these tests pin is which conversations end up in CloudCLI's list, the
 * directory each is filed under, and that no session row ever claims the shared
 * index as its own transcript.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { AntigravitySessionSynchronizer } from '@/modules/providers/list/antigravity/antigravity-session-synchronizer.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

/** One `conversation_summaries` row, defaulted to a plain CLI conversation. */
type SummaryRow = {
  conversation_id: string;
  title?: string;
  preview?: string;
  last_modified_time?: string;
  workspace_uris?: string | null;
  project_id?: string;
  app_data_dir?: string;
  nesting_depth?: number;
  parent_conversation_id?: string;
};

type Fixture = {
  rows: SummaryRow[];
  /** `cache/last_conversations.json`: workspace path -> newest conversation id. */
  lastConversations?: Record<string, string>;
  /** `~/.gemini/config/projects/<id>.json` records, keyed by project id. */
  projectRecords?: Record<string, unknown>;
  /**
   * A CloudCLI Project to create before the index is written. Its
   * database-assigned id replaces {@link CLOUDCLI_PROJECT_ID} in any row's
   * `project_id`, which is the id the runtime would have passed as `--project`.
   */
  cloudCliProject?: string;
};

/** Placeholder a fixture row uses for the CloudCLI project id it cannot know yet. */
const CLOUDCLI_PROJECT_ID = '{{cloudcli-project-id}}';

/**
 * Lays out the index (and the sibling files the resolver falls back to) under a
 * throwaway home, points the app database at a temp file, and runs the body.
 */
async function withIndex(
  fixture: Fixture,
  run: (context: {
    synchronizer: AntigravitySessionSynchronizer;
    homeDir: string;
    transcriptPath: (conversationId: string) => string;
  }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-sync-'));
  const homeDir = path.join(tempRoot, 'home');
  const appDataDir = path.join(homeDir, '.gemini', 'antigravity-cli');
  await fs.mkdir(path.join(appDataDir, 'cache'), { recursive: true });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  await fs.writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();
  const cloudCliProjectId = fixture.cloudCliProject
    ? projectsDb.createProjectPath(fixture.cloudCliProject).project?.project_id ?? ''
    : '';

  const indexPath = path.join(appDataDir, 'conversation_summaries.db');
  const index = new Database(indexPath);
  index.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      project_id TEXT,
      parent_conversation_id TEXT,
      nesting_depth INTEGER,
      app_data_dir TEXT
    );
  `);
  const insert = index.prepare(`
    INSERT INTO conversation_summaries (
      conversation_id, title, preview, step_count, last_modified_time,
      workspace_uris, project_id, parent_conversation_id, nesting_depth, app_data_dir
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of fixture.rows) {
    insert.run(
      row.conversation_id,
      row.title ?? '',
      row.preview ?? '',
      2,
      row.last_modified_time ?? '2026-09-21 03:49:45.368802+00:00',
      row.workspace_uris ?? null,
      (row.project_id ?? '').replace(CLOUDCLI_PROJECT_ID, cloudCliProjectId),
      row.parent_conversation_id ?? '',
      row.nesting_depth ?? 0,
      row.app_data_dir ?? 'antigravity-cli',
    );
  }
  index.close();

  if (fixture.lastConversations) {
    await fs.writeFile(
      path.join(appDataDir, 'cache', 'last_conversations.json'),
      JSON.stringify(fixture.lastConversations),
      'utf8',
    );
  }
  if (fixture.projectRecords) {
    const recordsDir = path.join(homeDir, '.gemini', 'config', 'projects');
    await fs.mkdir(recordsDir, { recursive: true });
    for (const [projectId, record] of Object.entries(fixture.projectRecords)) {
      await fs.writeFile(path.join(recordsDir, `${projectId}.json`), JSON.stringify(record), 'utf8');
    }
  }

  const restoreHomeDir = patchHomeDir(homeDir);

  try {
    await run({
      synchronizer: new AntigravitySessionSynchronizer(),
      homeDir,
      transcriptPath: (conversationId) => path.join(
        appDataDir, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl',
      ),
    });
  } finally {
    restoreHomeDir();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

const WORKSPACE_URI = 'file:///d%3A/code/demo';
const WORKSPACE_PATH = 'D:/code/demo';

test('a conversation with an added workspace root is filed under that directory', { concurrency: false }, async () => {
  await withIndex({
    rows: [{
      conversation_id: 'conv-a',
      preview: 'build the thing',
      workspace_uris: JSON.stringify([WORKSPACE_URI]),
    }],
  }, async ({ synchronizer }) => {
    assert.equal(await synchronizer.synchronize(), 1);

    const session = sessionsDb.getSessionByProviderSessionId('conv-a');
    assert.equal(session?.provider, 'antigravity');
    assert.equal(session?.custom_name, 'build the thing');
    assert.ok(session?.project_path?.toLowerCase().includes('code'));
  });
});

test('the shared index is never recorded as a session\'s transcript file', { concurrency: false }, async () => {
  // A session row naming it would make deleting one CloudCLI session delete the
  // Antigravity IDE's own state.
  await withIndex({
    rows: [{ conversation_id: 'conv-a', preview: 'x', workspace_uris: JSON.stringify([WORKSPACE_URI]) }],
  }, async ({ synchronizer }) => {
    await synchronizer.synchronize();
    assert.equal(sessionsDb.getSessionByProviderSessionId('conv-a')?.jsonl_path, null);
  });
});

test('the IDE\'s own conversations stay out of the CloudCLI list', { concurrency: false }, async () => {
  await withIndex({
    rows: [
      { conversation_id: 'cli-one', preview: 'mine', workspace_uris: JSON.stringify([WORKSPACE_URI]) },
      {
        conversation_id: 'ide-one',
        preview: 'theirs',
        workspace_uris: JSON.stringify([WORKSPACE_URI]),
        app_data_dir: 'antigravity',
      },
    ],
  }, async ({ synchronizer }) => {
    assert.equal(await synchronizer.synchronize(), 1);
    assert.ok(sessionsDb.getSessionByProviderSessionId('cli-one'));
    assert.equal(sessionsDb.getSessionByProviderSessionId('ide-one'), null);
  });
});

test('a subagent conversation is part of its parent\'s turn, not a sidebar row', { concurrency: false }, async () => {
  await withIndex({
    rows: [
      { conversation_id: 'parent', preview: 'top level', workspace_uris: JSON.stringify([WORKSPACE_URI]) },
      {
        conversation_id: 'nested',
        preview: 'subagent',
        workspace_uris: JSON.stringify([WORKSPACE_URI]),
        nesting_depth: 1,
        parent_conversation_id: 'parent',
      },
    ],
  }, async ({ synchronizer }) => {
    assert.equal(await synchronizer.synchronize(), 1);
    assert.equal(sessionsDb.getSessionByProviderSessionId('nested'), null);
  });
});

test('a conversation started in a terminal is filed through the --project id it carries', { concurrency: false }, async () => {
  // `--add-dir` fills `workspace_uris` and the runtime always passes it, so a
  // row without one was started outside CloudCLI; `--project` is what places it.
  await withIndex({
    cloudCliProject: WORKSPACE_PATH,
    rows: [{ conversation_id: 'conv-terminal', preview: 'from a terminal', project_id: CLOUDCLI_PROJECT_ID }],
  }, async ({ synchronizer }) => {
    assert.equal(await synchronizer.synchronize(), 1);

    const session = sessionsDb.getSessionByProviderSessionId('conv-terminal');
    assert.equal(session?.custom_name, 'from a terminal');
    assert.equal(session?.project_path, projectsDb.getProjectPath(WORKSPACE_PATH)?.project_path);
  });
});

test('a conversation with only a --project id is filed through the Antigravity project record', { concurrency: false }, async () => {
  await withIndex({
    rows: [{ conversation_id: 'conv-b', preview: 'started in a terminal', project_id: 'ide-owned' }],
    projectRecords: {
      'ide-owned': {
        id: 'ide-owned',
        projectResources: { resources: [{ folderUri: WORKSPACE_URI }] },
      },
    },
  }, async ({ synchronizer }) => {
    assert.equal(await synchronizer.synchronize(), 1);
    assert.ok(sessionsDb.getSessionByProviderSessionId('conv-b'));
  });
});

test('the workspace cache is the last resort for a conversation nothing else places', { concurrency: false }, async () => {
  await withIndex({
    rows: [{ conversation_id: 'conv-c', preview: 'no project, no workspace' }],
    lastConversations: { [WORKSPACE_PATH]: 'conv-c' },
  }, async ({ synchronizer }) => {
    assert.equal(await synchronizer.synchronize(), 1);
    assert.ok(sessionsDb.getSessionByProviderSessionId('conv-c'));
  });
});

test('a conversation no source can place is left out rather than guessed at', { concurrency: false }, async () => {
  await withIndex({
    rows: [{ conversation_id: 'conv-homeless', preview: 'nowhere' }],
  }, async ({ synchronizer }) => {
    assert.equal(await synchronizer.synchronize(), 0);
    assert.equal(sessionsDb.getSessionByProviderSessionId('conv-homeless'), null);
  });
});

test('an unparseable workspace_uris value does not take the whole scan down', { concurrency: false }, async () => {
  await withIndex({
    rows: [
      { conversation_id: 'broken', preview: 'bad uris', workspace_uris: '{not json' },
      { conversation_id: 'fine', preview: 'good', workspace_uris: JSON.stringify([WORKSPACE_URI]) },
    ],
  }, async ({ synchronizer }) => {
    assert.equal(await synchronizer.synchronize(), 1);
    assert.ok(sessionsDb.getSessionByProviderSessionId('fine'));
  });
});

test('an empty title falls back to the first user prompt', { concurrency: false }, async () => {
  // 1.2.5+ skips the title-generating model call for headless runs, so `title`
  // is empty for most conversations CloudCLI starts.
  await withIndex({
    rows: [
      {
        conversation_id: 'titled',
        title: 'A real title',
        preview: 'the prompt',
        workspace_uris: JSON.stringify([WORKSPACE_URI]),
      },
      {
        conversation_id: 'untitled',
        title: '',
        preview: 'just the prompt',
        workspace_uris: JSON.stringify([WORKSPACE_URI]),
      },
    ],
  }, async ({ synchronizer }) => {
    await synchronizer.synchronize();

    assert.equal(sessionsDb.getSessionByProviderSessionId('titled')?.custom_name, 'A real title');
    assert.equal(sessionsDb.getSessionByProviderSessionId('untitled')?.custom_name, 'just the prompt');
  });
});

test('a conversation with neither title nor preview gets a readable placeholder', { concurrency: false }, async () => {
  await withIndex({
    rows: [{ conversation_id: 'blank', workspace_uris: JSON.stringify([WORKSPACE_URI]) }],
  }, async ({ synchronizer }) => {
    await synchronizer.synchronize();
    assert.equal(
      sessionsDb.getSessionByProviderSessionId('blank')?.custom_name,
      'Untitled Antigravity Session',
    );
  });
});

test('a name the user chose survives a rescan', { concurrency: false }, async () => {
  await withIndex({
    rows: [{ conversation_id: 'conv-a', preview: 'agy\'s own preview', workspace_uris: JSON.stringify([WORKSPACE_URI]) }],
  }, async ({ synchronizer }) => {
    await synchronizer.synchronize();
    const sessionId = sessionsDb.getSessionByProviderSessionId('conv-a')!.session_id;
    sessionsDb.updateSessionCustomName(sessionId, 'My renamed session');

    await synchronizer.synchronize();

    assert.equal(sessionsDb.getSessionByProviderSessionId('conv-a')?.custom_name, 'My renamed session');
  });
});

test('running the scan twice changes nothing', { concurrency: false }, async () => {
  await withIndex({
    rows: [
      { conversation_id: 'conv-a', preview: 'one', workspace_uris: JSON.stringify([WORKSPACE_URI]) },
      { conversation_id: 'conv-b', preview: 'two', workspace_uris: JSON.stringify([WORKSPACE_URI]) },
    ],
  }, async ({ synchronizer }) => {
    assert.equal(await synchronizer.synchronize(), 2);
    assert.equal(await synchronizer.synchronize(), 2);

    assert.equal(sessionsDb.getAllSessions().filter((row) => row.provider === 'antigravity').length, 2);
  });
});

test('a rescan with a cursor only revisits conversations that moved', { concurrency: false }, async () => {
  await withIndex({
    rows: [
      {
        conversation_id: 'old',
        preview: 'last week',
        last_modified_time: '2026-09-01 10:00:00.000000+00:00',
        workspace_uris: JSON.stringify([WORKSPACE_URI]),
      },
      {
        conversation_id: 'new',
        preview: 'today',
        last_modified_time: '2026-09-21 10:00:00.000000+00:00',
        workspace_uris: JSON.stringify([WORKSPACE_URI]),
      },
    ],
  }, async ({ synchronizer }) => {
    assert.equal(await synchronizer.synchronize(new Date('2026-09-10T00:00:00Z')), 1);

    assert.ok(sessionsDb.getSessionByProviderSessionId('new'));
    assert.equal(sessionsDb.getSessionByProviderSessionId('old'), null);
  });
});

test('a transcript write indexes exactly the conversation it belongs to', { concurrency: false }, async () => {
  await withIndex({
    rows: [
      { conversation_id: 'conv-a', preview: 'one', workspace_uris: JSON.stringify([WORKSPACE_URI]) },
      { conversation_id: 'conv-b', preview: 'two', workspace_uris: JSON.stringify([WORKSPACE_URI]) },
    ],
  }, async ({ synchronizer, transcriptPath }) => {
    const sessionId = await synchronizer.synchronizeFile(transcriptPath('conv-b'));

    assert.equal(sessionId, sessionsDb.getSessionByProviderSessionId('conv-b')?.session_id);
    assert.equal(sessionsDb.getSessionByProviderSessionId('conv-a'), null);
  });
});

test('an index write indexes the newest conversation', { concurrency: false }, async () => {
  await withIndex({
    rows: [
      {
        conversation_id: 'stale',
        preview: 'older',
        last_modified_time: '2026-09-01 10:00:00.000000+00:00',
        workspace_uris: JSON.stringify([WORKSPACE_URI]),
      },
      {
        conversation_id: 'newest',
        preview: 'newer',
        last_modified_time: '2026-09-21 10:00:00.000000+00:00',
        workspace_uris: JSON.stringify([WORKSPACE_URI]),
      },
    ],
  }, async ({ synchronizer, homeDir }) => {
    const indexPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'conversation_summaries.db');

    const sessionId = await synchronizer.synchronizeFile(indexPath);

    assert.equal(sessionId, sessionsDb.getSessionByProviderSessionId('newest')?.session_id);
    assert.equal(sessionsDb.getSessionByProviderSessionId('stale'), null);
  });
});

test('a file that belongs to neither artifact is ignored', { concurrency: false }, async () => {
  await withIndex({
    rows: [{ conversation_id: 'conv-a', preview: 'one', workspace_uris: JSON.stringify([WORKSPACE_URI]) }],
  }, async ({ synchronizer, homeDir }) => {
    assert.equal(await synchronizer.synchronizeFile(path.join(homeDir, 'notes.txt')), null);
    assert.equal(sessionsDb.getAllSessions().length, 0);
  });
});

test('no index at all means nothing to do, not a failure', { concurrency: false }, async () => {
  await withIndex({ rows: [] }, async ({ synchronizer, homeDir }) => {
    await fs.rm(path.join(homeDir, '.gemini', 'antigravity-cli', 'conversation_summaries.db'), { force: true });

    assert.equal(await synchronizer.synchronize(), 0);
    assert.equal(await synchronizer.synchronizeFile('anything.jsonl'), null);
  });
});
