import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * Seam: the `chat.edit-send` frame, as the gateway hands it to the provider
 * runtime. An edit can never join a Claude process held for background work
 * (fork entry 29), so the server refuses it while that work runs; the
 * client's "Send anyway" then re-sends the same edit with `interruptBackground`,
 * which has to reach the runtime the way it does for `chat.send`.
 */

const SESSION_ID = 'edit-interrupt-session';

const TRANSCRIPT_ROWS = [
  {
    type: 'user', uuid: 'i-u1', parentUuid: null, sessionId: SESSION_ID,
    timestamp: '2026-11-09T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'first' }] },
  },
  {
    type: 'assistant', uuid: 'i-a1', parentUuid: 'i-u1', sessionId: SESSION_ID,
    timestamp: '2026-11-09T10:00:01.000Z',
    message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'reply' }] },
  },
  {
    type: 'user', uuid: 'i-u2', parentUuid: 'i-a1', sessionId: SESSION_ID,
    timestamp: '2026-11-09T10:00:02.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'second' }] },
  },
];

type RunCall = { command: string; options: Record<string, unknown> };

async function sendEdit(frame: Record<string, unknown>): Promise<RunCall[]> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-edit-send-interrupt-'));
  const transcriptPath = path.join(tempDirectory, `${SESSION_ID}.jsonl`);
  await writeFile(transcriptPath, `${TRANSCRIPT_ROWS.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const runs: RunCall[] = [];
  const socket = new EventEmitter() as EventEmitter & { readyState: number; send: (data: string) => void };
  socket.readyState = 1;
  socket.send = () => {};

  try {
    const now = new Date().toISOString();
    sessionsDb.createSession(SESSION_ID, 'claude', tempDirectory, 'Edit session', now, now, transcriptPath);
    handleChatConnection(
      socket as never,
      { user: { id: 1 } } as never,
      {
        runtime: {
          hasRuntime: () => true,
          run: async (_provider: string, command: string, options: Record<string, unknown>) => {
            runs.push({ command, options });
          },
        } as never,
      },
    );

    socket.emit('message', JSON.stringify({ type: 'chat.edit-send', sessionId: SESSION_ID, ...frame }));
    // The handler is async and the socket listener does not await it.
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    return runs;
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('an edit re-sent with "Send anyway" asks the runtime to stop the background work, and still resumes at its anchor', async () => {
  const runs = await sendEdit({ anchorId: 'i-u2', content: 'a better second prompt', interruptBackground: true });

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.options.interruptBackground, true);
  assert.equal(runs[0]?.options.resumeAnchorId, 'i-a1');
});

test('an ordinary edit does not ask to stop anything', async () => {
  const runs = await sendEdit({ anchorId: 'i-u2', content: 'a better second prompt' });

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.options.interruptBackground, false);
});
