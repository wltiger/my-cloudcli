import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  providerModelsDb,
  sessionsDb,
} from '@/modules/database/index.js';
import { runMigrations } from '@/modules/database/migrations.js';

test('provider model repository stores custom rows only and maintains session references', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    const columns = getConnection().prepare('PRAGMA table_info(provider_models)').all() as Array<{
      name: string;
    }>;
    assert.deepEqual(columns.map((column) => column.name), [
      'id',
      'provider',
      'model_id',
      'model_name',
      'sort_order',
      'created_at',
      'updated_at',
      'base_url',
      'api_key',
      'context_window',
      'effort_values',
      'effort_default',
      'system_prompt_agent',
      'system_prompt',
    ]);
    assert.deepEqual(providerModelsDb.listCustomProviderModels('codex'), []);

    const custom = providerModelsDb.createCustomProviderModel('codex', {
      model: 'Private Gateway Model',
      id: 'gateway/model-v1',
    });
    assert.equal(custom.modelId, 'gateway/model-v1');
    assert.equal(custom.baseUrl, null);
    assert.equal(custom.apiKey, null);
    assert.equal(custom.effort, null);
    assert.equal(
      providerModelsDb.findCustomProviderModelByModelId('codex', 'gateway/model-v1')?.recordId,
      custom.recordId,
    );

    const claudeCustom = providerModelsDb.createCustomProviderModel('claude', {
      model: 'My Local Model',
      id: 'local-model',
      baseUrl: 'http://localhost:11434',
      apiKey: 'sk-local-123',
      effort: { values: ['low', 'medium', 'xhigh'] },
    });
    assert.equal(claudeCustom.baseUrl, 'http://localhost:11434');
    assert.equal(claudeCustom.apiKey, 'sk-local-123');
    assert.deepEqual(claudeCustom.effort, { values: ['low', 'medium', 'xhigh'] });
    assert.equal(
      providerModelsDb.getCustomProviderModel('claude', claudeCustom.recordId)?.baseUrl,
      'http://localhost:11434',
    );
    assert.deepEqual(
      providerModelsDb.getCustomProviderModel('claude', claudeCustom.recordId)?.effort,
      { values: ['low', 'medium', 'xhigh'] },
    );

    const db = getConnection();
    db.prepare(`
      INSERT INTO projects (project_id, project_path)
      VALUES ('project-1', '/tmp/project-1')
    `).run();
    db.prepare(`
      INSERT INTO sessions (session_id, provider, project_path, model, effort)
      VALUES ('session-1', 'codex', '/tmp/project-1', 'gateway/model-v1', 'high')
    `).run();

    const updated = providerModelsDb.updateCustomProviderModel('codex', custom.recordId, {
      model: 'Private Gateway Model 2',
      id: 'gateway/model-v2',
    });
    assert.equal(updated?.modelId, 'gateway/model-v2');
    assert.equal(sessionsDb.getSessionById('session-1')?.model, 'gateway/model-v2');
    // A rename keeps the same underlying model, so its effort stays applicable.
    assert.equal(sessionsDb.getSessionById('session-1')?.effort, 'high');

    const removed = providerModelsDb.deleteCustomProviderModel(
      'codex',
      custom.recordId,
      'gpt-default',
    );
    assert.equal(removed?.modelId, 'gateway/model-v2');
    assert.equal(sessionsDb.getSessionById('session-1')?.model, 'gpt-default');
    // The effort belonged to the deleted model and must not survive onto the
    // fallback, which has its own default.
    assert.equal(sessionsDb.getSessionById('session-1')?.effort, null);
    assert.equal(providerModelsDb.getCustomProviderModel('codex', custom.recordId), null);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('migrations create the provider model index on an install that lacks it', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-index-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    const db = getConnection();
    // Upgraded installs reach runMigrations with provider_models present but no
    // index, so the CREATE INDEX statement is compiled against the real table
    // instead of short-circuiting on the existing index name.
    db.exec('DROP INDEX IF EXISTS idx_provider_models_provider_order');

    runMigrations(db);

    const indexedColumns = (db
      .prepare('PRAGMA index_info(idx_provider_models_provider_order)')
      .all() as Array<{ name: string }>)
      .map((column) => column.name);
    assert.deepEqual(indexedColumns, ['provider', 'sort_order', 'id']);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('provider model repository persists declared effort levels', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-effort-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    const custom = providerModelsDb.createCustomProviderModel('claude', {
      model: 'My Custom Model',
      id: 'my-custom-model',
      effort: { values: ['low', 'high'], default: 'high' },
    });
    assert.deepEqual(custom.effort, { values: ['low', 'high'], default: 'high' });
    assert.deepEqual(
      providerModelsDb.listCustomProviderModels('claude')[0]?.effort,
      { values: ['low', 'high'], default: 'high' },
    );

    // Omitting effort on update keeps the stored levels.
    const renamed = providerModelsDb.updateCustomProviderModel('claude', custom.recordId, {
      model: 'Renamed',
      id: 'my-custom-model',
    });
    assert.deepEqual(renamed?.effort, { values: ['low', 'high'], default: 'high' });

    const narrowed = providerModelsDb.updateCustomProviderModel('claude', custom.recordId, {
      model: 'Renamed',
      id: 'my-custom-model',
      effort: { values: ['medium'] },
    });
    assert.deepEqual(narrowed?.effort, { values: ['medium'] });

    const cleared = providerModelsDb.updateCustomProviderModel('claude', custom.recordId, {
      model: 'Renamed',
      id: 'my-custom-model',
      effort: null,
    });
    assert.equal(cleared?.effort, null);
    const row = getConnection()
      .prepare('SELECT effort_values, effort_default FROM provider_models WHERE id = ?')
      .get(custom.recordId);
    assert.deepEqual(row, { effort_values: null, effort_default: null });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('migrations add effort columns to an existing provider model table and keep old rows NULL', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-effort-migration-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  // The table as it shipped before effort metadata existed, with one user row.
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
    CREATE TABLE provider_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL CHECK (provider IN ('claude', 'cursor', 'codex', 'opencode')),
      model_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, model_id)
    );
    INSERT INTO provider_models (provider, model_id, model_name, sort_order)
    VALUES ('codex', 'legacy-model', 'Legacy Model', 0);
  `);
  legacyDb.close();

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    const columnNames = (getConnection().prepare('PRAGMA table_info(provider_models)').all() as Array<{
      name: string;
    }>).map((column) => column.name);
    assert.deepEqual(columnNames.slice(-4), [
      'effort_values',
      'effort_default',
      'system_prompt_agent',
      'system_prompt',
    ]);

    const [legacy] = providerModelsDb.listCustomProviderModels('codex');
    assert.equal(legacy?.modelId, 'legacy-model');
    assert.equal(legacy?.effort, null);
    assert.equal(legacy?.systemPromptAgent, null);
    assert.equal(legacy?.systemPrompt, null);

    // Running the migrations again is a no-op.
    runMigrations(getConnection());
    assert.equal(providerModelsDb.listCustomProviderModels('codex')[0]?.effort, null);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("migrations carry the fork's former effort_levels into effort_values and drop the column", async () => {
  // Both shapes a fork database can be in: rebuilt by the antigravity CHECK
  // widening on this start, or already widened (the rebuild is skipped).
  for (const providers of ["'claude', 'cursor', 'codex', 'opencode'", "'claude', 'cursor', 'codex', 'opencode', 'antigravity'"]) {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-effort-levels-'));
    const databasePath = path.join(tempDirectory, 'auth.db');

    const legacyDb = new Database(databasePath);
    legacyDb.exec(`
      CREATE TABLE provider_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK (provider IN (${providers})),
        model_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        base_url TEXT,
        api_key TEXT,
        effort_levels TEXT,
        context_window INTEGER,
        UNIQUE(provider, model_id)
      );
      INSERT INTO provider_models (provider, model_id, model_name, sort_order, base_url, api_key, effort_levels, context_window)
      VALUES ('claude', 'local-model', 'Local Model', 0, 'http://localhost:11434', 'sk-local', '["low","medium","xhigh"]', 204800);
    `);
    legacyDb.close();

    closeConnection();
    process.env.DATABASE_PATH = databasePath;
    await initializeDatabase();

    try {
      const columnNames = (getConnection().prepare('PRAGMA table_info(provider_models)').all() as Array<{
        name: string;
      }>).map((column) => column.name);
      assert.equal(columnNames.includes('effort_levels'), false, `${providers}: the legacy column is gone`);
      assert.deepEqual(columnNames.slice(-4), [
        'effort_values',
        'effort_default',
        'system_prompt_agent',
        'system_prompt',
      ]);

      const [model] = providerModelsDb.listCustomProviderModels('claude');
      assert.deepEqual(model?.effort, { values: ['low', 'medium', 'xhigh'] }, `${providers}: declared levels survive`);
      assert.equal(model?.baseUrl, 'http://localhost:11434');
      assert.equal(model?.contextWindow, 204800);

      runMigrations(getConnection());
      assert.deepEqual(providerModelsDb.listCustomProviderModels('claude')[0]?.effort, { values: ['low', 'medium', 'xhigh'] });
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
});

test('provider model repository stores, replaces and clears the system prompt source', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-system-prompt-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    const plain = providerModelsDb.createCustomProviderModel('claude', {
      model: 'Plain',
      id: 'plain-model',
    });
    assert.equal(plain.systemPromptAgent, null);
    assert.equal(plain.systemPrompt, null);

    const withAgent = providerModelsDb.createCustomProviderModel('claude', {
      model: 'Agent model',
      id: 'agent-model',
      systemPromptAgent: 'dispatch-coder',
    });
    assert.equal(withAgent.systemPromptAgent, 'dispatch-coder');
    assert.equal(withAgent.systemPrompt, null);

    const longPrompt = 'line one\n\nline two\n'.repeat(100);
    const switched = providerModelsDb.updateCustomProviderModel('claude', withAgent.recordId, {
      model: 'Agent model',
      id: 'agent-model',
      systemPrompt: longPrompt,
    });
    assert.equal(switched?.systemPromptAgent, null);
    assert.equal(switched?.systemPrompt, longPrompt);
    assert.equal(
      providerModelsDb.getCustomProviderModel('claude', withAgent.recordId)?.systemPrompt,
      longPrompt,
    );

    // An update that names neither field clears both, like the endpoint columns.
    const cleared = providerModelsDb.updateCustomProviderModel('claude', withAgent.recordId, {
      model: 'Agent model',
      id: 'agent-model',
    });
    assert.equal(cleared?.systemPromptAgent, null);
    assert.equal(cleared?.systemPrompt, null);
    assert.deepEqual(
      getConnection()
        .prepare('SELECT system_prompt_agent, system_prompt FROM provider_models WHERE id = ?')
        .get(withAgent.recordId),
      { system_prompt_agent: null, system_prompt: null },
    );
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('the CHECK-widening rebuild keeps the system prompt columns and every row it copies', async () => {
  // A fresh database already lists 'antigravity', which makes the rebuild skip
  // itself, so each shape below is a hand-built table that still lacks it.
  const shapes = [
    {
      label: 'old table without the system prompt columns',
      extraColumns: '',
      extraNames: '',
      extraValues: '',
      expectedAgent: null,
      expectedPrompt: null,
    },
    {
      label: 'old table whose system prompt columns already hold data',
      extraColumns: ', system_prompt_agent TEXT, system_prompt TEXT',
      extraNames: ', system_prompt_agent, system_prompt',
      extraValues: ", 'dispatch-coder', 'You are a coder.\n\nBe brief.'",
      expectedAgent: 'dispatch-coder',
      expectedPrompt: 'You are a coder.\n\nBe brief.',
    },
  ];

  for (const shape of shapes) {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-system-prompt-rebuild-'));
    const databasePath = path.join(tempDirectory, 'auth.db');

    const legacyDb = new Database(databasePath);
    legacyDb.exec(`
      CREATE TABLE provider_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK (provider IN ('claude', 'cursor', 'codex', 'opencode')),
        model_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        base_url TEXT,
        api_key TEXT,
        context_window INTEGER${shape.extraColumns},
        UNIQUE(provider, model_id)
      );
      INSERT INTO provider_models (provider, model_id, model_name, sort_order, base_url, api_key, context_window${shape.extraNames})
      VALUES ('claude', 'local-model', 'Local Model', 0, 'http://localhost:11434', 'sk-local', 204800${shape.extraValues});
      INSERT INTO provider_models (provider, model_id, model_name, sort_order)
      VALUES ('codex', 'legacy-model', 'Legacy Model', 1);
    `);
    const tableSqlBefore = (legacyDb
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'provider_models'")
      .get() as { sql: string }).sql;
    assert.equal(tableSqlBefore.includes("'antigravity'"), false, `${shape.label}: the old table must not list antigravity`);
    legacyDb.close();

    closeConnection();
    process.env.DATABASE_PATH = databasePath;
    await initializeDatabase();

    try {
      const db = getConnection();
      const tableSqlAfter = (db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'provider_models'")
        .get() as { sql: string }).sql;
      assert.equal(tableSqlAfter.includes("'antigravity'"), true, `${shape.label}: the rebuild ran`);

      const columnNames = (db.prepare('PRAGMA table_info(provider_models)').all() as Array<{
        name: string;
      }>).map((column) => column.name);
      assert.deepEqual(columnNames.slice(-4), [
        'effort_values',
        'effort_default',
        'system_prompt_agent',
        'system_prompt',
      ], shape.label);

      const [claudeModel] = providerModelsDb.listCustomProviderModels('claude');
      assert.equal(claudeModel?.modelId, 'local-model', shape.label);
      assert.equal(claudeModel?.baseUrl, 'http://localhost:11434', shape.label);
      assert.equal(claudeModel?.apiKey, 'sk-local', shape.label);
      assert.equal(claudeModel?.contextWindow, 204800, shape.label);
      assert.equal(claudeModel?.systemPromptAgent, shape.expectedAgent, shape.label);
      assert.equal(claudeModel?.systemPrompt, shape.expectedPrompt, shape.label);

      const [codexModel] = providerModelsDb.listCustomProviderModels('codex');
      assert.equal(codexModel?.modelId, 'legacy-model', shape.label);
      assert.equal(codexModel?.systemPromptAgent, null, shape.label);

      // The rebuilt table accepts the new provider and writes the new columns.
      const created = providerModelsDb.createCustomProviderModel('antigravity', {
        model: 'Agy model',
        id: 'agy-model',
      });
      assert.equal(created.systemPrompt, null, shape.label);
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
});
