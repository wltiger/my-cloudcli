/**
 * Antigravity transcript reading, driven by real files under a temporary home.
 *
 * Every test lays out an actual
 * `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`
 * and asks the real facet what a user would see in the transcript pane. No
 * mocks, no process, no network.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AntigravitySessionsProvider } from '@/modules/providers/list/antigravity/antigravity-sessions.provider.js';
import type { NormalizedMessage } from '@/shared/types.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const CONVERSATION_ID = 'conv-0001';

/** One `transcript.jsonl` record, with the fields every real record carries. */
const record = (
  stepIndex: number,
  fields: Record<string, unknown>,
): Record<string, unknown> => ({
  step_index: stepIndex,
  status: 'DONE',
  created_at: '2026-09-20T23:46:50Z',
  ...fields,
});

const userRecord = (stepIndex: number, content: string) =>
  record(stepIndex, { source: 'USER_EXPLICIT', type: 'USER_INPUT', content });

const modelRecord = (stepIndex: number, fields: Record<string, unknown>) =>
  record(stepIndex, { source: 'MODEL', type: 'PLANNER_RESPONSE', ...fields });

const toolResultRecord = (stepIndex: number, content: string, extra: Record<string, unknown> = {}) =>
  record(stepIndex, { source: 'MODEL', type: 'GENERIC', content, ...extra });

/** A plain assistant text record: no tool calls, so it renders as one bubble. */
const assistantTextRecord = (stepIndex: number, content: string) =>
  record(stepIndex, { source: 'MODEL', type: 'PLANNER_RESPONSE', content });

/**
 * Lays out one conversation under a throwaway home and hands the real facet to
 * the test body.
 */
async function withTranscript(
  files: { transcript: unknown[]; full?: unknown[]; rawTranscript?: string },
  run: (provider: AntigravitySessionsProvider, homeDir: string) => Promise<void>,
): Promise<void> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-sessions-'));
  const restoreHomeDir = patchHomeDir(homeDir);
  try {
    const logDir = path.join(
      homeDir, '.gemini', 'antigravity-cli', 'brain', CONVERSATION_ID, '.system_generated', 'logs',
    );
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(
      path.join(logDir, 'transcript.jsonl'),
      files.rawTranscript ?? `${files.transcript.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      'utf8',
    );
    if (files.full) {
      await fs.writeFile(
        path.join(logDir, 'transcript_full.jsonl'),
        `${files.full.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
        'utf8',
      );
    }

    await run(new AntigravitySessionsProvider(), homeDir);
  } finally {
    restoreHomeDir();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

const history = (provider: AntigravitySessionsProvider) =>
  provider.fetchHistory(CONVERSATION_ID, { providerSessionId: CONVERSATION_ID });

const kinds = (messages: NormalizedMessage[]): string[] =>
  messages.map((message) => String(message.kind));

test('a user prompt renders as what the user typed, not as the envelope agy stores', async () => {
  await withTranscript({
    transcript: [
      userRecord(0, '<USER_REQUEST>add a readme</USER_REQUEST><ADDITIONAL_METADATA>cwd=/tmp</ADDITIONAL_METADATA>'),
    ],
  }, async (provider) => {
    const { messages } = await history(provider);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.role, 'user');
    assert.equal(messages[0]?.content, 'add a readme');
  });
});

test('a prompt with no envelope still has its trailing metadata block stripped', async () => {
  await withTranscript({
    transcript: [userRecord(0, 'add a readme\n<ADDITIONAL_METADATA>cwd=/tmp</ADDITIONAL_METADATA>')],
  }, async (provider) => {
    const { messages } = await history(provider);
    assert.equal(messages[0]?.content, 'add a readme');
  });
});

test('a tool call is paired with the result record that follows it', async () => {
  await withTranscript({
    transcript: [
      modelRecord(1, {
        thinking: 'I should build first.',
        tool_calls: [{ name: 'run_command', args: { CommandLine: '"npm run build"', Cwd: '"/tmp"' } }],
      }),
      toolResultRecord(2, 'build ok'),
    ],
  }, async (provider) => {
    const { messages } = await history(provider);

    assert.deepEqual(kinds(messages), ['thinking', 'tool_use']);
    const tool = messages[1]!;
    assert.equal(tool.toolName, 'run_command');
    // Every argument is persisted as its own JSON literal; decoding it is what
    // keeps the tool card from showing the command wrapped in stray quotes.
    assert.deepEqual(tool.toolInput, { CommandLine: 'npm run build', Cwd: '/tmp' });
    assert.deepEqual(tool.toolResult, { content: 'build ok', isError: false });
    // The result record is consumed into the card, not rendered as a second
    // anonymous blob of tool output.
    assert.equal(messages.length, 2);
  });
});

test('parallel tool calls each keep their own result', async () => {
  await withTranscript({
    transcript: [
      modelRecord(1, {
        tool_calls: [{ name: 'read_file', args: { Path: '"a.txt"' } }, { name: 'read_file', args: { Path: '"b.txt"' } }],
      }),
      toolResultRecord(2, 'contents of a'),
      toolResultRecord(3, 'contents of b'),
    ],
  }, async (provider) => {
    const { messages } = await history(provider);

    assert.deepEqual(kinds(messages), ['tool_use', 'tool_use']);
    assert.equal(messages[0]?.toolResult?.content, 'contents of a');
    assert.equal(messages[1]?.toolResult?.content, 'contents of b');
  });
});

test('a tool call whose result never arrived keeps a card with no result', async () => {
  await withTranscript({
    transcript: [modelRecord(1, { tool_calls: [{ name: 'run_command', args: {} }] })],
  }, async (provider) => {
    const { messages } = await history(provider);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.kind, 'tool_use');
    assert.equal(messages[0]?.toolResult, undefined);
  });
});

test('records written out of order are read back in step order', async () => {
  // `agy` appends parallel tool results as they land, so a turn that called two
  // tools at once can write step 3 before step 2.
  await withTranscript({
    transcript: [
      userRecord(0, '<USER_REQUEST>first</USER_REQUEST>'),
      assistantTextRecord(3, 'third'),
      assistantTextRecord(2, 'second'),
    ],
  }, async (provider) => {
    const { messages } = await history(provider);

    assert.deepEqual(
      messages.map((message) => message.content),
      ['first', 'second', 'third'],
    );
  });
});

test('elided text is restored from the untruncated transcript', async () => {
  await withTranscript({
    transcript: [
      modelRecord(1, { content: 'The full answer is…', thinking: 'thin…', truncated_fields: ['content', 'thinking'] }),
    ],
    full: [
      modelRecord(1, { content: 'The full answer is forty-two.', thinking: 'thinking it through carefully' }),
    ],
  }, async (provider) => {
    const { messages } = await history(provider);

    assert.equal(messages.find((message) => message.kind === 'thinking')?.content, 'thinking it through carefully');
    assert.equal(messages.find((message) => message.kind === 'text')?.content, 'The full answer is forty-two.');
  });
});

test('a field agy names as truncated but this reader does not render is left alone', async () => {
  await withTranscript({
    transcript: [modelRecord(1, { content: 'kept', truncated_fields: ['summary'] })],
    full: [modelRecord(1, { content: 'kept', summary: 'invented key' })],
  }, async (provider) => {
    const { messages } = await history(provider);

    assert.equal(messages[0]?.content, 'kept');
    assert.equal((messages[0] as Record<string, unknown>).summary, undefined);
  });
});

test('a half-written final line does not cost the reader the whole conversation', async () => {
  // Normal while a turn is in flight: the last line is flushed in pieces.
  await withTranscript({
    transcript: [],
    rawTranscript: [
      JSON.stringify(userRecord(0, '<USER_REQUEST>hello</USER_REQUEST>')),
      JSON.stringify(assistantTextRecord(1, 'hi there')),
      '{"step_index":2,"source":"MODEL","content":"half a rec',
    ].join('\n'),
  }, async (provider) => {
    const { messages, total } = await history(provider);

    assert.deepEqual(messages.map((message) => message.content), ['hello', 'hi there']);
    assert.equal(total, 2);
  });
});

test('a line that is valid JSON but not an object is skipped', async () => {
  await withTranscript({
    transcript: [],
    rawTranscript: [
      '"just a string"',
      '[1,2,3]',
      JSON.stringify(assistantTextRecord(1, 'still here')),
      '',
    ].join('\n'),
  }, async (provider) => {
    const { messages } = await history(provider);
    assert.deepEqual(messages.map((message) => message.content), ['still here']);
  });
});

test('a step type this fork has never seen still renders everything it carries', async () => {
  // The observed `type` vocabulary is a floor, not a closed set: a record of an
  // unknown type must not vanish from the transcript.
  await withTranscript({
    transcript: [
      record(1, { source: 'MODEL', type: 'CHECKPOINT_SUMMARY', content: 'checkpoint reached', thinking: 'why' }),
    ],
  }, async (provider) => {
    const { messages } = await history(provider);

    assert.deepEqual(kinds(messages), ['thinking', 'text']);
    assert.equal(messages[1]?.content, 'checkpoint reached');
    assert.equal(messages[1]?.role, 'assistant');
  });
});

test('a system notice agy injects into its own conversation is shown, not dropped', async () => {
  await withTranscript({
    transcript: [record(1, { source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: 'Auto-compaction ran.' })],
  }, async (provider) => {
    const { messages } = await history(provider);
    assert.equal(messages[0]?.content, 'Auto-compaction ran.');
  });
});

test('a standalone failure is its own bubble', async () => {
  await withTranscript({
    transcript: [record(1, { source: 'MODEL', type: 'GENERIC', status: 'ERROR', content: 'model overloaded' })],
  }, async (provider) => {
    const { messages } = await history(provider);

    assert.deepEqual(kinds(messages), ['error']);
    assert.equal(messages[0]?.content, 'model overloaded');
  });
});

test('a failure that belongs to a tool call is reported once, on that call', async () => {
  await withTranscript({
    transcript: [
      modelRecord(1, { error: 'permission denied', tool_calls: [{ name: 'run_command', args: {} }] }),
    ],
  }, async (provider) => {
    const { messages } = await history(provider);

    // Not two failures: the error rides on the card rather than also becoming a
    // separate error bubble above it.
    assert.deepEqual(kinds(messages), ['tool_use']);
  });
});

test('a failed tool result marks the card as failed', async () => {
  await withTranscript({
    transcript: [
      modelRecord(1, { tool_calls: [{ name: 'run_command', args: {} }] }),
      toolResultRecord(2, '', { status: 'ERROR', error: 'exit code 1' }),
    ],
  }, async (provider) => {
    const { messages } = await history(provider);
    assert.deepEqual(messages[0]?.toolResult, { content: 'exit code 1', isError: true });
  });
});

test('attachments come back out of the prompt instead of rendering as raw tags', async () => {
  await withTranscript({
    transcript: [
      // The block the runtime appends to the prompt, since stream-json input
      // accepts text blocks only and there is no native attachment block.
      userRecord(0, [
        '<USER_REQUEST>look at this',
        '<images_input>',
        'The user attached 1 image(s) to this message.',
        '1. /tmp/assets/shot.png (original name: shot.png)',
        '</images_input></USER_REQUEST>',
      ].join('\n')),
    ],
  }, async (provider) => {
    const { messages } = await history(provider);

    assert.equal(messages[0]?.content, 'look at this');
    assert.deepEqual(messages[0]?.images, [{ path: '/tmp/assets/shot.png', name: 'shot.png' }]);
  });
});

test('message ids are stable across re-reads so a rewritten file updates rows', async () => {
  await withTranscript({
    transcript: [userRecord(0, '<USER_REQUEST>hi</USER_REQUEST>'), assistantTextRecord(1, 'hello')],
  }, async (provider) => {
    const first = await history(provider);
    const second = await history(provider);

    assert.deepEqual(first.messages.map((message) => message.id), second.messages.map((message) => message.id));
    assert.deepEqual(first.messages.map((message) => message.id), [
      `antigravity-${CONVERSATION_ID}-0-user`,
      `antigravity-${CONVERSATION_ID}-1-text`,
    ]);
  });
});

test('pagination returns the tail page and reports whether more is behind it', async () => {
  await withTranscript({
    transcript: [0, 1, 2, 3, 4].map((index) => assistantTextRecord(index, `step ${index}`)),
  }, async (provider) => {
    const page = await provider.fetchHistory(CONVERSATION_ID, {
      providerSessionId: CONVERSATION_ID,
      limit: 2,
    });

    assert.deepEqual(page.messages.map((message) => message.content), ['step 3', 'step 4']);
    assert.equal(page.total, 5);
    assert.equal(page.hasMore, true);
    assert.equal(page.limit, 2);
  });
});

test('limit 0 is an empty page, not an unbounded one', async () => {
  await withTranscript({
    transcript: [0, 1, 2].map((index) => assistantTextRecord(index, `step ${index}`)),
  }, async (provider) => {
    const empty = await provider.fetchHistory(CONVERSATION_ID, {
      providerSessionId: CONVERSATION_ID,
      limit: 0,
    });
    const unbounded = await provider.fetchHistory(CONVERSATION_ID, {
      providerSessionId: CONVERSATION_ID,
      limit: null,
    });

    assert.deepEqual(empty.messages, []);
    assert.equal(empty.total, 3);
    assert.equal(empty.hasMore, true);
    assert.equal(unbounded.messages.length, 3);
    assert.equal(unbounded.hasMore, false);
  });
});

test('a conversation with no transcript reads as empty rather than failing', async () => {
  await withTranscript({ transcript: [] }, async (provider) => {
    const result = await provider.fetchHistory('conversation-that-never-ran', {
      providerSessionId: 'conversation-that-never-ran',
    });

    assert.deepEqual(result, { messages: [], total: 0, hasMore: false, offset: 0, limit: null });
  });
});

test('a conversation id that is not a single path segment reads nothing', async () => {
  // The id is a key from a database another application writes, so it never
  // becomes a path that can climb out of the brain directory.
  await withTranscript({ transcript: [userRecord(0, 'x')] }, async (provider) => {
    for (const id of ['../../etc', 'a/b', '..']) {
      const result = await provider.fetchHistory(id, { providerSessionId: id });
      assert.deepEqual(result.messages, [], `id ${id} must read nothing`);
    }
  });
});

test('one live record normalizes on its own, without a result it cannot see', async () => {
  await withTranscript({ transcript: [] }, async (provider) => {
    const messages = provider.normalizeMessage(
      modelRecord(4, { content: 'done', tool_calls: [{ name: 'run_command', args: {} }] }),
      'session-abc',
    );

    assert.deepEqual(kinds(messages), ['text', 'tool_use']);
    assert.equal(messages[1]?.toolResult, undefined);
    assert.equal(messages[0]?.id, 'antigravity-session-abc-4-text');
  });
});

test('a raw value that is not a record normalizes to nothing', async () => {
  await withTranscript({ transcript: [] }, async (provider) => {
    assert.deepEqual(provider.normalizeMessage('not a record', 'session-abc'), []);
    assert.deepEqual(provider.normalizeMessage(null, null), []);
  });
});
