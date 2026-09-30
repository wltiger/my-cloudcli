/**
 * What the on-disk session watcher attaches to, and which files under those
 * roots are synchronization triggers.
 *
 * Antigravity is the provider that makes this worth pinning: its tree holds
 * three kinds of `.jsonl` under one root — the transcript, the untruncated
 * transcript beside it, and 100 KiB chunk mirrors of both — and only the first
 * may drive `synchronizeFile`. Everything here runs against a temporary home
 * with fixture files; `agy` is never installed or invoked.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  closeSessionsWatcher,
  getProviderWatchPaths,
  isWatcherTargetFile,
  onUpdate,
  WATCHER_IGNORED_PATTERNS,
} from '@/modules/providers/services/sessions-watcher.service.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

/**
 * Chokidar 4's own matching rules, reproduced: a string matcher is an equality
 * test and a RegExp is tested against the path after it is normalized to
 * forward slashes (`createPattern`/`normalizePath` in `chokidar/esm/index.js`).
 * Asserting against the real semantics is the point — a glob string here would
 * silently never match.
 */
const isIgnored = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, '/');
  return WATCHER_IGNORED_PATTERNS.some((pattern) => (
    pattern instanceof RegExp ? pattern.test(normalized) : pattern === normalized
  ));
};

test('antigravity watches the conversation tree and the title files, and only when they already exist', () => {
  const restoreHomeDir = patchHomeDir('/tmp/fake-home');
  try {
    const paths = getProviderWatchPaths();
    const antigravity = paths.filter((entry) => entry.provider === 'antigravity');

    assert.deepEqual(
      antigravity.map((entry) => entry.rootPath),
      [
        path.join('/tmp/fake-home', '.gemini', 'antigravity-cli', 'brain'),
        path.join('/tmp/fake-home', '.gemini', 'antigravity-cli', 'annotations'),
      ],
    );
    // A machine with no `agy` must pay nothing: no directory created, so
    // `initializeSessionsWatcher` skips the root instead of attaching to it.
    assert.deepEqual(antigravity.map((entry) => entry.createIfMissing), [false, false]);

    // The four providers that were here first keep creating their roots.
    for (const provider of ['claude', 'cursor', 'codex', 'opencode'] as const) {
      const entry = paths.find((candidate) => candidate.provider === provider);
      assert.notEqual(entry, undefined);
      assert.notEqual(entry?.createIfMissing, false);
    }
  } finally {
    restoreHomeDir();
  }
});

test('only the top-level transcript is an antigravity synchronization trigger', () => {
  const logsDir = '/home/u/.gemini/antigravity-cli/brain/conv-a/.system_generated/logs';

  assert.equal(isWatcherTargetFile('antigravity', `${logsDir}/transcript.jsonl`), true);
  // Rewritten in lockstep with the transcript; synchronizing on it would
  // repeat the same work for the same conversation.
  assert.equal(isWatcherTargetFile('antigravity', `${logsDir}/transcript_full.jsonl`), false);
  assert.equal(isWatcherTargetFile('antigravity', `${logsDir}/chunks/transcript/00000000.jsonl`), false);
  assert.equal(isWatcherTargetFile('antigravity', `${logsDir}/chunks/transcript_full/00000001.jsonl`), false);

  // The title file is a trigger; a writer's temp file and any other file are not.
  const annotationsDir = '/home/u/.gemini/antigravity-cli/annotations';
  assert.equal(isWatcherTargetFile('antigravity', `${annotationsDir}/conv-a.pbtxt`), true);
  assert.equal(isWatcherTargetFile('antigravity', `${annotationsDir}/conv-a.pbtxt.4242.tmp`), false);
  assert.equal(isWatcherTargetFile('antigravity', '/home/u/elsewhere/conv-a.pbtxt'), false);

  // The other providers keep their own rules.
  assert.equal(isWatcherTargetFile('claude', '/home/u/.claude/projects/p/abc.jsonl'), true);
  assert.equal(isWatcherTargetFile('opencode', '/home/u/.local/share/opencode/opencode.db'), true);
});

test('the chunk mirrors are ignored before chokidar ever reports them', () => {
  const logsDir = '/home/u/.gemini/antigravity-cli/brain/conv-a/.system_generated/logs';

  assert.equal(isIgnored(`${logsDir}/chunks/transcript/00000000.jsonl`), true);
  assert.equal(isIgnored(`${logsDir}/chunks/transcript_full/00000000.jsonl`), true);
  assert.equal(isIgnored(`${logsDir}/transcript.jsonl`), false);
});

test('a transcript event indexes the conversation while a chunk event does nothing', { concurrency: false }, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-watch-'));
  const homeDir = path.join(tempRoot, 'home');
  const appDataDir = path.join(homeDir, '.gemini', 'antigravity-cli');
  const logsDir = path.join(appDataDir, 'brain', 'conv-live', '.system_generated', 'logs');
  await fs.mkdir(path.join(logsDir, 'chunks', 'transcript'), { recursive: true });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  await fs.writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();

  const index = new Database(path.join(appDataDir, 'conversation_summaries.db'));
  index.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT, title TEXT, preview TEXT, step_count INTEGER,
      last_modified_time TEXT, workspace_uris TEXT, project_id TEXT,
      parent_conversation_id TEXT, nesting_depth INTEGER, app_data_dir TEXT,
      not_fully_idle INTEGER, killed INTEGER
    );
  `);
  index.prepare(`
    INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'conv-live', '', 'watch me', 2, '2026-09-21 03:49:45.368802+00:00',
    JSON.stringify(['file:///d%3A/code/demo']), '', '', 0, 'antigravity-cli', 0, 0,
  );
  index.close();

  const restoreHomeDir = patchHomeDir(homeDir);
  try {
    const chunkPath = path.join(logsDir, 'chunks', 'transcript', '00000000.jsonl');
    await fs.writeFile(chunkPath, '{}\n');
    await onUpdate('change', chunkPath, 'antigravity');
    assert.equal(sessionsDb.getSessionByProviderSessionId('conv-live'), null);

    const transcriptPath = path.join(logsDir, 'transcript.jsonl');
    await fs.writeFile(transcriptPath, '{}\n');
    await onUpdate('change', transcriptPath, 'antigravity');
    assert.equal(sessionsDb.getSessionByProviderSessionId('conv-live')?.provider, 'antigravity');

    // A title written to the annotation file renames the session, although the
    // index row is untouched — and a writer's temp file does nothing.
    const annotationPath = path.join(appDataDir, 'annotations', 'conv-live.pbtxt');
    await fs.mkdir(path.dirname(annotationPath), { recursive: true });
    await fs.writeFile(`${annotationPath}.4242.tmp`, 'title:"from tmp"');
    await onUpdate('add', `${annotationPath}.4242.tmp`, 'antigravity');
    assert.equal(sessionsDb.getSessionByProviderSessionId('conv-live')?.custom_name, 'watch me');

    await fs.writeFile(annotationPath, 'title:"[Review/Agy] 标题"');
    await onUpdate('change', annotationPath, 'antigravity');
    assert.equal(sessionsDb.getSessionByProviderSessionId('conv-live')?.custom_name, '[Review/Agy] 标题');
  } finally {
    restoreHomeDir();
    await closeSessionsWatcher();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
