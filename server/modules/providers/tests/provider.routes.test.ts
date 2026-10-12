import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import providerRouter from '@/modules/providers/provider.routes.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { BackgroundTaskSummary, WorkflowAgentActivity } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

async function withProviderServer(
  run: (baseUrl: string, workspacePath: string) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-routes-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();

  const app = express().use(express.json()).use('/api/providers', providerRouter);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`, path.join(tempDirectory, 'workspace'));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('session creation route names a CloudCLI session from the initial message', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    const response = await fetch(`${baseUrl}/api/providers/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        projectPath: workspacePath,
        initialMessage: 'abcd  efg\nhij klm nop',
      }),
    });
    const payload = await response.json() as {
      data: { sessionId: string; sessionName: string };
    };

    assert.equal(response.status, 201);
    assert.equal(payload.data.sessionName, 'abcd efg hij klm');
    assert.equal(
      sessionsDb.getSessionById(payload.data.sessionId)?.custom_name,
      'abcd efg hij klm',
    );
  });
});

test('conversation search streams title matches before transcript results', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession(
      'title-only-session',
      'codex',
      workspacePath,
      'Release planning notes',
    );
    const transcriptPath = path.join(path.dirname(workspacePath), 'codex-search.jsonl');
    await writeFile(transcriptPath, `${JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-12T09:00:00.000Z',
      payload: {
        type: 'user_message',
        kind: 'plain',
        message: 'Release planning also appears in this conversation.',
      },
    })}\n`);
    sessionsDb.createSession(
      'transcript-session',
      'codex',
      workspacePath,
      'Unrelated session',
      undefined,
      undefined,
      transcriptPath,
    );

    const response = await fetch(
      `${baseUrl}/api/providers/search/sessions?q=release%20planning&limit=50`,
    );
    const eventStream = await response.text();
    const titleEventIndex = eventStream.indexOf('event: title-results');
    const conversationEventIndex = eventStream.indexOf('event: result');
    const doneEventIndex = eventStream.indexOf('event: done');

    assert.equal(response.status, 200);
    assert.ok(titleEventIndex >= 0);
    assert.ok(conversationEventIndex > titleEventIndex);
    assert.ok(doneEventIndex > titleEventIndex);

    const titleDataLine = eventStream
      .slice(titleEventIndex, conversationEventIndex)
      .split('\n')
      .find((line) => line.startsWith('data: '));
    assert.ok(titleDataLine);

    const titlePayload = JSON.parse(titleDataLine.slice('data: '.length)) as {
      titleResults: Array<{
        sessionId: string;
        sessionTitle: string;
        provider: string;
      }>;
    };
    assert.equal(titlePayload.titleResults.length, 1);
    assert.equal(titlePayload.titleResults[0]?.sessionId, 'title-only-session');
    assert.equal(titlePayload.titleResults[0]?.sessionTitle, 'Release planning notes');
    assert.equal(titlePayload.titleResults[0]?.provider, 'codex');
  });
});

test('reasoning effort is persisted and returned with the active session model', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('effort-session', 'codex', workspacePath);

    const updateResponse = await fetch(
      `${baseUrl}/api/providers/codex/sessions/effort-session/active-effort`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ effort: 'ultra' }),
      },
    );
    const updatePayload = await updateResponse.json() as {
      data: { effort: string; sessionId: string };
    };

    assert.equal(updateResponse.status, 200);
    assert.equal(updatePayload.data.effort, 'ultra');
    assert.equal(sessionsDb.getSessionById('effort-session')?.effort, 'ultra');

    const readResponse = await fetch(
      `${baseUrl}/api/providers/codex/sessions/effort-session/active-model`,
    );
    const readPayload = await readResponse.json() as {
      data: { effort: string | null; sessionId: string };
    };

    assert.equal(readResponse.status, 200);
    assert.equal(readPayload.data.sessionId, 'effort-session');
    assert.equal(readPayload.data.effort, 'ultra');
  });
});

test('model routes expose immutable defaults and full custom model CRUD', async () => {
  await withProviderServer(async (baseUrl) => {
    const initialResponse = await fetch(`${baseUrl}/api/providers/codex/models`);
    const initialPayload = await initialResponse.json() as {
      data: {
        cache?: unknown;
        models: {
          OPTIONS: Array<{ recordId?: number; value: string; isCustom: boolean }>;
        };
      };
    };
    assert.equal(initialResponse.status, 200);
    assert.equal('cache' in initialPayload.data, false);
    const predefined = initialPayload.data.models.OPTIONS[0];
    assert.equal(predefined.isCustom, false);
    assert.equal(predefined.recordId, undefined);

    const createResponse = await fetch(`${baseUrl}/api/providers/codex/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'Gateway GPT', id: 'gateway/gpt' }),
    });
    const createPayload = await createResponse.json() as {
      data: { model: { recordId: number; value: string; label: string; isCustom: boolean } };
    };
    assert.equal(createResponse.status, 201);
    assert.equal(createPayload.data.model.isCustom, true);
    const customRecordId = createPayload.data.model.recordId;

    const updateResponse = await fetch(
      `${baseUrl}/api/providers/codex/models/${customRecordId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'Gateway GPT Updated', id: 'gateway/gpt-v2' }),
      },
    );
    const updatePayload = await updateResponse.json() as {
      data: { model: { value: string; label: string } };
    };
    assert.equal(updateResponse.status, 200);
    assert.equal(updatePayload.data.model.value, 'gateway/gpt-v2');
    assert.equal(updatePayload.data.model.label, 'Gateway GPT Updated');

    const immutableResponse = await fetch(
      `${baseUrl}/api/providers/codex/models/999999`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'Changed', id: 'changed' }),
      },
    );
    const immutablePayload = await immutableResponse.json() as { error: { code: string } };
    assert.equal(immutableResponse.status, 404);
    assert.equal(immutablePayload.error.code, 'MODEL_NOT_FOUND');

    const deleteResponse = await fetch(
      `${baseUrl}/api/providers/codex/models/${customRecordId}`,
      { method: 'DELETE' },
    );
    const deletePayload = await deleteResponse.json() as {
      data: { models: { OPTIONS: Array<{ recordId: number }> } };
    };
    assert.equal(deleteResponse.status, 200);
    assert.equal(
      deletePayload.data.models.OPTIONS.some((option) => option.recordId === customRecordId),
      false,
    );
  });
});

test('the fork route refuses a request with no anchor', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('fork-source', 'claude', workspacePath, 'Wire up the sidebar');
    sessionsDb.assignProviderSessionId('fork-source', 'claude-native-1');

    const missingAnchorResponse = await fetch(
      `${baseUrl}/api/providers/sessions/fork-source/fork-at-anchor`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '[Fork] Wire up the sidebar' }),
      },
    );
    const missingAnchorPayload = await missingAnchorResponse.json() as {
      error: { code: string };
    };
    assert.equal(missingAnchorResponse.status, 400);
    assert.equal(missingAnchorPayload.error.code, 'ANCHOR_REQUIRED');
  });
});

test('the fork-name route answers with a name the project has not used', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('fork-source', 'claude', workspacePath, 'Retry');
    sessionsDb.createAppSession('earlier-fork', 'claude', workspacePath, '[Fork] Retry');

    const response = await fetch(
      `${baseUrl}/api/providers/sessions/fork-source/fork-name`,
    );
    const payload = await response.json() as { data: { suggestedName: string } };

    assert.equal(response.status, 200);
    assert.equal(payload.data.suggestedName, '[Fork] Retry (2)');
  });
});

test('the clear route retires the open conversation and answers with the empty one', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('clear-source', 'claude', workspacePath, 'Wire up the sidebar');
    sessionsDb.assignProviderSessionId('clear-source', 'claude-native-1');

    const response = await fetch(
      `${baseUrl}/api/providers/sessions/clear-source/clear`,
      { method: 'POST' },
    );
    const payload = await response.json() as {
      data: { sessionId: string; retiredSessionId: string; retiredSessionName: string };
    };

    assert.equal(response.status, 201);
    assert.equal(payload.data.retiredSessionId, 'clear-source');
    assert.equal(payload.data.retiredSessionName, '[Cleared] Wire up the sidebar');
    assert.notEqual(payload.data.sessionId, 'clear-source');
    assert.equal(sessionsDb.getSessionById('clear-source')?.isArchived, 1);
    assert.equal(sessionsDb.getSessionById(payload.data.sessionId)?.isArchived, 0);
  });
});
/**
 * The Antigravity grant route writes into `~/.gemini/config/projects/`, a
 * directory the Antigravity IDE also owns, so every case here runs against a
 * throwaway home rather than the one the developer is signed into.
 */
async function withAntigravityHome(
  run: (baseUrl: string, projectPath: string, readGrants: () => Promise<string[]>) => Promise<void>,
): Promise<void> {
  await withProviderServer(async (baseUrl, workspacePath) => {
    const homeDir = path.join(path.dirname(workspacePath), 'home');
    const recordsDir = path.join(homeDir, '.gemini', 'config', 'projects');
    await mkdir(recordsDir, { recursive: true });

    const originalHomeDir = os.homedir;
    (os as any).homedir = () => homeDir;
    try {
      await run(baseUrl, workspacePath, async () => {
        const files = await readdir(recordsDir);
        const grants: string[] = [];
        for (const file of files) {
          const record = JSON.parse(await readFile(path.join(recordsDir, file), 'utf8')) as {
            permissionGrants?: { permissionGrants?: { allow?: string[] } };
          };
          grants.push(...(record.permissionGrants?.permissionGrants?.allow ?? []));
        }
        return grants;
      });
    } finally {
      (os as any).homedir = originalHomeDir;
    }
  });
}

const postGrant = (baseUrl: string, provider: string, body: unknown) => fetch(
  `${baseUrl}/api/providers/${provider}/permissions/grants`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  },
);

test('granting an Antigravity action reports the project it landed in', async () => {
  await withAntigravityHome(async (baseUrl, projectPath, readGrants) => {
    const response = await postGrant(baseUrl, 'antigravity', {
      projectPath,
      rule: 'command(npm run build)',
    });
    const payload = await response.json() as {
      data: { provider: string; projectId: string; rule: string; alreadyAllowed: boolean };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.data.provider, 'antigravity');
    assert.equal(payload.data.rule, 'command(npm run build)');
    assert.equal(payload.data.alreadyAllowed, false);
    assert.ok(payload.data.projectId, 'the route must name the record the grant applies in');
    assert.deepEqual(await readGrants(), ['command(npm run build)']);
  });
});

test('granting the same action again says so instead of duplicating it', async () => {
  await withAntigravityHome(async (baseUrl, projectPath, readGrants) => {
    await postGrant(baseUrl, 'antigravity', { projectPath, rule: 'command(npm run build)' });
    const response = await postGrant(baseUrl, 'antigravity', {
      projectPath,
      rule: 'command(npm run build)',
    });
    const payload = await response.json() as { data: { alreadyAllowed: boolean } };

    assert.equal(response.status, 200);
    assert.equal(payload.data.alreadyAllowed, true);
    assert.deepEqual(await readGrants(), ['command(npm run build)']);
  });
});

test('a bare command is refused before anything is written', async () => {
  await withAntigravityHome(async (baseUrl, projectPath, readGrants) => {
    const response = await postGrant(baseUrl, 'antigravity', { projectPath, rule: 'npm run build' });
    const payload = await response.json() as { error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, 'ANTIGRAVITY_INVALID_GRANT_RULE');
    assert.deepEqual(await readGrants(), []);
  });
});

test('a wildcard or partial rule is refused — agy matches the whole action', async () => {
  await withAntigravityHome(async (baseUrl, projectPath, readGrants) => {
    for (const rule of ['Bash(npm:*)', 'command()', 'commandx(npm)', 'command(npm) --force']) {
      const response = await postGrant(baseUrl, 'antigravity', { projectPath, rule });
      const payload = await response.json() as { error: { code: string } };

      assert.equal(response.status, 400, `rule ${rule} must be refused`);
      assert.equal(payload.error.code, 'ANTIGRAVITY_INVALID_GRANT_RULE');
    }

    assert.deepEqual(await readGrants(), []);
  });
});

test('a grant with no project says which field is missing', async () => {
  await withAntigravityHome(async (baseUrl) => {
    const missingPath = await postGrant(baseUrl, 'antigravity', { rule: 'command(npm run build)' });
    assert.equal(missingPath.status, 400);
    assert.equal((await missingPath.json() as { error: { code: string } }).error.code, 'PROJECT_PATH_REQUIRED');

    const missingRule = await postGrant(baseUrl, 'antigravity', { projectPath: 'D:/code/demo' });
    assert.equal(missingRule.status, 400);
    assert.equal((await missingRule.json() as { error: { code: string } }).error.code, 'PERMISSION_RULE_REQUIRED');
  });
});

test('no other provider pre-grants permissions', async () => {
  await withAntigravityHome(async (baseUrl, projectPath) => {
    for (const provider of ['claude', 'codex', 'cursor', 'opencode']) {
      const response = await postGrant(baseUrl, provider, {
        projectPath,
        rule: 'command(npm run build)',
      });
      const payload = await response.json() as { error: { code: string } };

      assert.equal(response.status, 400, `${provider} must refuse the grant route`);
      assert.equal(payload.error.code, 'PROVIDER_PERMISSION_GRANTS_UNSUPPORTED');
    }
  });
});

// ---------------------------------------------------------------------------
// Antigravity media — one image a tool result recorded
// ---------------------------------------------------------------------------

/**
 * Lays out one conversation's media directory under a temporary home and serves
 * the real router over HTTP. The security boundary has to be tested here: an
 * attacker crafts a request directly and never goes through the session reader.
 */
async function withAntigravityMediaServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'agy-media-'));
  const originalHomedir = os.homedir;

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();
  (os as any).homedir = () => tempDirectory;

  const conversationDir = path.join(tempDirectory, '.gemini', 'antigravity-cli', 'brain', 'conv-media');
  const mediaDir = path.join(conversationDir, '.tempmediaStorage');
  await mkdir(mediaDir, { recursive: true });
  await writeFile(path.join(mediaDir, 'shot.png'), 'not-really-a-png');
  await writeFile(path.join(mediaDir, 'notes.txt'), 'text');
  await writeFile(path.join(mediaDir, 'evil.svg'), '<svg onload="alert(1)"/>');
  // Screenshots the model saved itself, linked from its prose.
  await writeFile(path.join(conversationDir, '01-guide.png'), 'root-png');
  await mkdir(path.join(conversationDir, 'scratch', 'shots'), { recursive: true });
  await writeFile(path.join(conversationDir, 'scratch', 'shots', 'deep.png'), 'deep-png');
  await writeFile(path.join(conversationDir, 'scratch', 'notes.txt'), 'text');
  await mkdir(path.join(tempDirectory, 'outside'), { recursive: true });
  await writeFile(path.join(tempDirectory, 'outside', 'secret.png'), 'secret');
  // A link inside the conversation that leads out of it. A junction needs no
  // elevation on Windows; elsewhere the type is ignored and this is a symlink.
  await symlink(path.join(tempDirectory, 'outside'), path.join(conversationDir, 'linked'), 'junction');

  const app = express().use(express.json()).use('/api/providers', providerRouter);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    (os as any).homedir = originalHomedir;
    // Before the rm: the open connection holds the db file, and on Windows an
    // open file cannot be unlinked.
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('an image stored for a conversation is served with its image content type', async () => {
  await withAntigravityMediaServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/antigravity/media/conv-media/shot.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
  });
});

test('a media request cannot climb out of the conversation directory', async () => {
  await withAntigravityMediaServer(async (baseUrl) => {
    // An attacker crafts these directly, so the reader's own filtering is not
    // the boundary — this route is.
    for (const fileName of [
      '..%2F..%2F..%2Foutside%2Fsecret.png',
      '..%5C..%5C..%5Coutside%5Csecret.png',
      '..%2Fsecret.png',
    ]) {
      const response = await fetch(
        `${baseUrl}/api/providers/antigravity/media/conv-media/${fileName}`,
      );
      assert.equal(response.status, 404, `traversal via ${fileName} must 404`);
    }

    // A conversation id that is not a single segment is rejected too.
    const escaped = await fetch(
      `${baseUrl}/api/providers/antigravity/media/..%2Foutside/shot.png`,
    );
    assert.equal(escaped.status, 404);
  });
});

test('a non-image file in the media directory is not served', async () => {
  await withAntigravityMediaServer(async (baseUrl) => {
    const text = await fetch(`${baseUrl}/api/providers/antigravity/media/conv-media/notes.txt`);
    assert.equal(text.status, 404);

    // SVG is excluded: serving another application's SVG inline is an XSS
    // surface, whatever the upload path allows elsewhere.
    const svg = await fetch(`${baseUrl}/api/providers/antigravity/media/conv-media/evil.svg`);
    assert.equal(svg.status, 404);
  });
});

test('a missing image 404s, so the frontend can show a placeholder', async () => {
  await withAntigravityMediaServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/antigravity/media/conv-media/gone.png`);
    assert.equal(response.status, 404);
  });
});

test('an image anywhere in the conversation directory is served by its path there', async () => {
  await withAntigravityMediaServer(async (baseUrl) => {
    const media = (filePath: string) => fetch(`${baseUrl}/api/providers/antigravity/media/conv-media/${filePath}`);

    const root = await media('01-guide.png');
    assert.equal(root.status, 200);
    assert.equal(await root.text(), 'root-png');

    const deep = await media('scratch/shots/deep.png');
    assert.equal(deep.status, 200);
    assert.equal(deep.headers.get('content-type'), 'image/png');
    assert.equal(await deep.text(), 'deep-png');

    // The bare name every tool-result thumbnail already uses still means the
    // `.tempmediaStorage` file, and the full path reaches the same one.
    assert.equal(await (await media('shot.png')).text(), 'not-really-a-png');
    assert.equal(await (await media('.tempmediaStorage/shot.png')).text(), 'not-really-a-png');

    assert.equal((await media('scratch/notes.txt')).status, 404);
  });
});

test('a deeper media path cannot climb out of the conversation directory either', async () => {
  await withAntigravityMediaServer(async (baseUrl) => {
    for (const filePath of [
      'scratch/..%2F..%2F..%2F..%2F..%2Foutside%2Fsecret.png',
      'scratch%2F..%2F..%2F..%2F..%2F..%2Foutside%2Fsecret.png',
      'scratch/shots%5C..%5C..%5Cdeep.png',
      'C:%2Fsecret.png',
      'scratch/C:secret.png',
      '%2Foutside%2Fsecret.png',
      'scratch//shots/deep.png',
      '',
    ]) {
      const response = await fetch(`${baseUrl}/api/providers/antigravity/media/conv-media/${filePath}`);
      assert.equal(response.status, 404, `${filePath || 'an empty path'} must 404`);
    }

    // Every segment is clean here; only the real path shows where it leads.
    const linked = await fetch(`${baseUrl}/api/providers/antigravity/media/conv-media/linked/secret.png`);
    assert.equal(linked.status, 404, 'a link out of the conversation must 404');
  });
});

test('another provider has no media route', async () => {
  await withAntigravityMediaServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/claude/media/conv-media/shot.png`);
    assert.equal(response.status, 400);
  });
});

test('custom model routes accept, validate, and return reasoning-effort levels', async () => {
  await withProviderServer(async (baseUrl) => {
    const postModel = async (provider: string, body: unknown) => {
      const response = await fetch(`${baseUrl}/api/providers/${provider}/models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        payload: await response.json() as {
          data?: {
            model: { recordId: number; effort?: unknown };
            models: { OPTIONS: Array<{ value: string; effort?: unknown }> };
          };
          error?: { code: string; message?: string };
        },
      };
    };

    const created = await postModel('claude', {
      model: 'My Custom Model',
      id: 'my-custom-model',
      effort: { values: [' low ', 'high'], default: 'high' },
    });
    const expectedEffort = { default: 'high', values: [{ value: 'low' }, { value: 'high' }] };
    assert.equal(created.status, 201);
    assert.deepEqual(created.payload.data?.model.effort, expectedEffort);

    const catalogResponse = await fetch(`${baseUrl}/api/providers/claude/models`);
    const catalogPayload = await catalogResponse.json() as {
      data: { models: { OPTIONS: Array<{ value: string; effort?: unknown }>; EFFORT_LEVELS?: string[] } };
    };
    assert.deepEqual(
      catalogPayload.data.models.OPTIONS.find((option) => option.value === 'my-custom-model')?.effort,
      expectedEffort,
    );
    // The model library's toggles come from here, not from the built-in models.
    assert.deepEqual(
      catalogPayload.data.models.EFFORT_LEVELS,
      ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    );

    // OpenCode's allowed levels do not depend on which upstream providers the
    // machine running the tests has connected.
    const openCodeModel = await postModel('opencode', {
      model: 'Router model',
      id: 'openrouter/router-model',
      effort: { values: ['none', 'high'] },
    });
    assert.equal(openCodeModel.status, 201, JSON.stringify(openCodeModel.payload));
    assert.deepEqual(openCodeModel.payload.data?.model.effort, { values: [{ value: 'none' }, { value: 'high' }] });

    // A PATCH from a client that predates effort metadata keeps the levels.
    const renameResponse = await fetch(
      `${baseUrl}/api/providers/claude/models/${created.payload.data?.model.recordId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'Renamed', id: 'my-custom-model' }),
      },
    );
    const renamePayload = await renameResponse.json() as { data: { model: { effort?: unknown } } };
    assert.equal(renameResponse.status, 200);
    assert.deepEqual(renamePayload.data.model.effort, expectedEffort);

    const invalidPayloads: Array<{ provider: string; effort: unknown; code: string }> = [
      { provider: 'claude', effort: { values: ['low', 'low'] }, code: 'INVALID_MODEL_EFFORT' },
      { provider: 'claude', effort: { values: ['low', ''] }, code: 'INVALID_MODEL_EFFORT' },
      { provider: 'claude', effort: { values: ['low'], default: 'high' }, code: 'INVALID_MODEL_EFFORT' },
      { provider: 'claude', effort: { values: ['turbo'] }, code: 'INVALID_MODEL_EFFORT' },
      { provider: 'claude', effort: 'high', code: 'INVALID_MODEL_EFFORT' },
      { provider: 'cursor', effort: { values: ['low'] }, code: 'MODEL_EFFORT_NOT_SUPPORTED' },
    ];
    for (const [index, invalid] of invalidPayloads.entries()) {
      const rejected = await postModel(invalid.provider, {
        model: `Invalid ${index}`,
        id: `invalid-${index}`,
        effort: invalid.effort,
      });
      assert.equal(rejected.status, 400, JSON.stringify(invalid));
      assert.equal(rejected.payload.error?.code, invalid.code, JSON.stringify(invalid));
    }

    // An oversized list is refused by its length, before any entry is walked:
    // the JSON parser accepts bodies of up to 50 MB.
    const oversized = await postModel('claude', {
      model: 'Oversized',
      id: 'oversized',
      effort: { values: Array.from({ length: 33 }, (_, index) => `level-${index}`) },
    });
    assert.equal(oversized.status, 400);
    assert.equal(oversized.payload.error?.code, 'INVALID_MODEL_EFFORT');
    assert.match(oversized.payload.error?.message ?? '', /at most 32 effort levels/);
  });
});

test('the running-sessions route reports a session held open for background work', async () => {
  // The client polls this route to keep every tab's activity map in step, so
  // a session whose turn ended but whose agent is still running has to be in
  // the payload — flagged as background work, with the tasks to show and stop.
  const tasks: BackgroundTaskSummary[] = [{
    taskId: 'a73dc7a6442f7c415',
    toolUseId: 'toolu_013sUz4iWcNjN6BskVkHUCAr',
    taskType: 'local_agent',
    description: 'Investigate the flaky test',
    startedAt: 1_700_000_000_000,
  }];
  const realListProviders = providerRegistry.listProviders;
  providerRegistry.listProviders = () => [{
    id: 'claude',
    runtime: { listBackgroundWork: () => [{ sessionId: 'held-session', tasks }] },
  } as unknown as IProvider];

  try {
    await withProviderServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/providers/sessions/running`);
      const payload = await response.json() as { data: { sessions: unknown[] } };

      assert.equal(response.status, 200);
      assert.deepEqual(payload.data.sessions, [{
        sessionId: 'held-session',
        provider: 'claude',
        startedAt: 1_700_000_000_000,
        lastSeq: 0,
        background: true,
        canInterrupt: false,
        tasks,
      }]);
    });
  } finally {
    providerRegistry.listProviders = realListProviders;
  }
});

const WORKFLOW_SESSION_ID = 'claude-workflow-routes-session';
const WORKFLOW_RUN_ID = 'wf_16fbf852-274';
const FINISHED_AGENT_ID = 'aa1e064cf8bd159d6';
const UNREPORTED_AGENT_ID = 'ab89f2cde612a51b1';

/**
 * Writes a workflow run's directory the way a real run leaves it under the
 * session's transcript directory: one `agent-<id>.jsonl` per agent, in the
 * row shape an Agent subagent's transcript has, and the journal beside them.
 */
async function writeWorkflowRun(projectDirectory: string): Promise<string> {
  const sessionPath = path.join(projectDirectory, `${WORKFLOW_SESSION_ID}.jsonl`);
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify({ type: 'user', uuid: 'u1', sessionId: WORKFLOW_SESSION_ID, timestamp: '2026-08-21T10:32:10.000Z', message: { role: 'user', content: 'audit the frontend' } })}\n`, 'utf8');

  const runDir = path.join(projectDirectory, WORKFLOW_SESSION_ID, 'subagents', 'workflows', WORKFLOW_RUN_ID);
  await mkdir(runDir, { recursive: true });

  const agentRows = (agentId: string) => [
    { parentUuid: null, isSidechain: true, agentId, type: 'user', uuid: `${agentId}-u1`, timestamp: '2026-08-21T10:32:20.000Z', message: { role: 'user', content: 'You are the analysis step of a code-quality audit.' } },
    { parentUuid: `${agentId}-u1`, isSidechain: true, agentId, type: 'assistant', uuid: `${agentId}-a1`, timestamp: '2026-08-21T10:32:25.000Z', message: { role: 'assistant', model: 'claude-opus-4-1', content: [{ type: 'tool_use', id: `toolu_${agentId}_1`, name: 'Grep', input: { pattern: 'useSidebar' } }] } },
    { parentUuid: `${agentId}-a1`, isSidechain: true, agentId, type: 'user', uuid: `${agentId}-u2`, timestamp: '2026-08-21T10:32:26.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${agentId}_1`, content: 'src/modules/sidebar/useSidebar.ts' }] } },
    { parentUuid: `${agentId}-u2`, isSidechain: true, agentId, type: 'assistant', uuid: `${agentId}-a2`, timestamp: '2026-08-21T10:32:40.000Z', message: { role: 'assistant', model: 'claude-opus-4-1', content: [{ type: 'text', text: 'One hook owns the sidebar.' }] } },
  ];
  for (const agentId of [FINISHED_AGENT_ID, UNREPORTED_AGENT_ID]) {
    await writeFile(path.join(runDir, `agent-${agentId}.jsonl`), `${agentRows(agentId).map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    await writeFile(path.join(runDir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'workflow-subagent', spawnDepth: 1 }), 'utf8');
  }
  const journal = [
    { type: 'started', key: 'v2:one', agentId: FINISHED_AGENT_ID, label: 'audit:sidebar', phase: 'Audit' },
    { type: 'started', key: 'v2:two', agentId: UNREPORTED_AGENT_ID, label: 'synthesize', phase: 'Synthesize' },
    { type: 'result', key: 'v2:one', agentId: FINISHED_AGENT_ID, result: { area: 'sidebar' } },
  ];
  await writeFile(path.join(runDir, 'journal.jsonl'), `${journal.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

  return sessionPath;
}

test('the workflow agent route reads an agent\'s timeline and status from its run directory', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    const sessionPath = await writeWorkflowRun(workspacePath);
    const now = new Date().toISOString();
    sessionsDb.createSession(WORKFLOW_SESSION_ID, 'claude', workspacePath, 'Workflow session', now, now, sessionPath);

    const agentUrl = (runId: string, agentId: string) =>
      `${baseUrl}/api/providers/sessions/${WORKFLOW_SESSION_ID}/workflows/${runId}/agents/${agentId}`;

    // The SDK streams none of an agent's rows to the parent, so its transcript
    // is the only record of what it did — read on demand, capped like an
    // Agent card's, and settled by the journal beside it.
    const finishedResponse = await fetch(agentUrl(WORKFLOW_RUN_ID, FINISHED_AGENT_ID));
    const finished = (await finishedResponse.json() as { data: WorkflowAgentActivity }).data;
    assert.equal(finishedResponse.status, 200);
    assert.deepEqual(finished.agent, { id: FINISHED_AGENT_ID, label: 'audit:sidebar', model: 'claude-opus-4-1', status: 'completed' });
    assert.equal(finished.activityCount, 2);
    assert.deepEqual(finished.activity.map((entry) => entry.kind), ['tool', 'text']);
    assert.equal(finished.activity[0]?.toolName, 'Grep');
    assert.deepEqual(finished.activity[0]?.toolInput, { pattern: 'useSidebar' });
    assert.deepEqual(finished.activity[0]?.toolResult, { content: 'src/modules/sidebar/useSidebar.ts', isError: false });
    assert.equal(finished.activity[1]?.content, 'One hook owns the sidebar.');

    // A `started` with no `result` or `failed`, and no live run of the session
    // to still be working in: nothing can report for it any more.
    const unreportedResponse = await fetch(agentUrl(WORKFLOW_RUN_ID, UNREPORTED_AGENT_ID));
    const unreported = (await unreportedResponse.json() as { data: WorkflowAgentActivity }).data;
    assert.equal(unreportedResponse.status, 200);
    assert.equal(unreported.agent.status, 'stopped');
    assert.equal(unreported.agent.label, 'synthesize');

    // Both ids name a file under the session directory, so neither may carry
    // anything but the harness's own shapes — not even a well-formed
    // directory that happens to exist.
    for (const [runId, agentId, code] of [
      [`${WORKFLOW_RUN_ID}%2F..`, FINISHED_AGENT_ID, 'INVALID_WORKFLOW_RUN_ID'],
      ['subagents', FINISHED_AGENT_ID, 'INVALID_WORKFLOW_RUN_ID'],
      [WORKFLOW_RUN_ID, '..%2Fjournal', 'INVALID_WORKFLOW_AGENT_ID'],
      [WORKFLOW_RUN_ID, 'aa1e064cf8bd159d', 'INVALID_WORKFLOW_AGENT_ID'],
    ] as const) {
      const response = await fetch(agentUrl(runId, agentId));
      const payload = await response.json() as { error: { code: string } };
      assert.equal(response.status, 400, `${runId}/${agentId}`);
      assert.equal(payload.error.code, code);
    }

    const missingResponse = await fetch(agentUrl(WORKFLOW_RUN_ID, 'a0000000000000000'));
    const missing = await missingResponse.json() as { error: { code: string } };
    assert.equal(missingResponse.status, 404);
    assert.equal(missing.error.code, 'WORKFLOW_AGENT_NOT_FOUND');
  });
});
