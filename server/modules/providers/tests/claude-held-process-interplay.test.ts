import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { claudeRuntime, queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { hasHeldTurn } from '@/modules/providers/list/claude/claude-turn-reuse.js';
import type { ProviderRuntimeContext, SideQuestionRequest } from '@/shared/types.js';

/**
 * Seam: `queryClaudeSDK` against a scripted SDK query, where upstream's
 * steering and side questions meet this fork's held process (fork entries
 * 29–31). These pin the two places the v1.37.8 merge combined by hand:
 * `settleTurnResult` settles a claimed follow-up only once its steered
 * messages were read, and a release deferred for a pending native side
 * question unpublishes the held process, so no follow-up is pushed into it.
 */

const SESSION_ID = 'app-held-interplay';
const NATIVE_ID = 'native-held-interplay';

type NativeAsk = (question: string, options?: { signal?: AbortSignal }) => Promise<unknown>;

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
  released: () => boolean;
  consumed: () => number;
  prompts: () => number;
};

function createScriptedQuery(askSideQuestion?: NativeAsk): {
  createQuery: NonNullable<ProviderRuntimeContext['createQuery']>;
  script: Scripted;
} {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  let consumed = 0;
  let prompts = 0;

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    consumed: () => consumed,
    prompts: () => prompts,
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const _message of prompt) {
        prompts += 1;
      }
      released = true;
    })();

    const iterator = (async function* () {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        const next = queue.shift();
        if (next === null || next === undefined) {
          return;
        }
        yield next;
        consumed += 1;
      }
    })();

    const instance = Object.assign(iterator, { interrupt: async () => {}, stopTask: async () => {} });
    if (askSideQuestion) {
      Object.assign(instance, { askSideQuestion: (question: string, options?: { signal?: AbortSignal }) => askSideQuestion(question, options) });
    }
    return instance;
  };

  return { createQuery, script };
}

function forkQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; calls: () => number } {
  let calls = 0;
  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = () => {
    calls += 1;
    const iterator = (async function* () {
      yield {
        type: 'assistant', session_id: 'fork-session', parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'text', text: 'FORK ANSWER' }] },
      };
      yield { type: 'result', subtype: 'success', session_id: 'fork-session', result: 'FORK ANSWER', duration_ms: 1, num_turns: 1 };
    })();
    return Object.assign(iterator, { interrupt: async () => {} });
  };
  return { createQuery, calls: () => calls };
}

function context(createQuery: NonNullable<ProviderRuntimeContext['createQuery']>): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
    createQuery,
  };
}

function recordingWriter() {
  const frames: Array<Record<string, unknown>> = [];
  return { writer: { send: (frame: Record<string, unknown>) => { frames.push(frame); }, userId: null }, frames };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      assert.ok(condition(), `condition never became true within ${timeoutMs}ms`);
      return;
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, 5); });
  }
}

async function emitAndFlush(script: Scripted, message: Record<string, unknown>): Promise<void> {
  const before = script.consumed();
  script.emit(message);
  await waitFor(() => script.consumed() > before);
}

const init = () => ({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
const result = () => ({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'done', duration_ms: 1, num_turns: 1 });
const backgroundShell = () => ({
  type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'sleep 100', run_in_background: true } }] },
});
const taskStarted = () => ({
  type: 'system', subtype: 'task_started', session_id: NATIVE_ID, task_id: 'b1', tool_use_id: 'toolu_bash', description: 'sleep 100', task_type: 'local_bash',
});
const taskCompleted = () => ({
  type: 'system', subtype: 'task_notification', session_id: NATIVE_ID, task_id: 'b1', tool_use_id: 'toolu_bash', status: 'completed', summary: 'done', output_file: '',
});

/** A first turn that leaves a background shell running, so its process is held. */
async function startHeldRun(script: Scripted, createQuery: NonNullable<ProviderRuntimeContext['createQuery']>, cwd: string) {
  const { writer, frames } = recordingWriter();
  const run = queryClaudeSDK('start a shell', { sessionId: SESSION_ID, cwd }, writer as never, context(createQuery));
  await emitAndFlush(script, init());
  await emitAndFlush(script, backgroundShell());
  await emitAndFlush(script, taskStarted());
  await emitAndFlush(script, result());
  await settle();
  assert.equal(script.released(), false, 'the process is held for the shell');
  assert.equal(hasHeldTurn(SESSION_ID), true);
  return { run, frames };
}

test('a follow-up pushed into the held process, with a steer it has not read, settles only after the turn that reads it', { concurrency: false }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-held-interplay-'));
  const held = createScriptedQuery();
  try {
    const first = await startHeldRun(held.script, held.createQuery, cwd);

    // The follow-up is claimed and pushed into the same process.
    const followUp = recordingWriter();
    let followUpSettled = false;
    const followUpRun = queryClaudeSDK('next step', { sessionId: SESSION_ID, cwd }, followUp.writer as never, context(held.createQuery))
      .then(() => { followUpSettled = true; });
    await waitFor(() => held.script.prompts() === 2);

    // A message steered into that pushed turn.
    assert.equal(await claudeRuntime.steer(SESSION_ID, 'also check the tests', { messageId: 'steer-1' }), true);
    await waitFor(() => held.script.prompts() === 3);

    // The turn ends before Claude reads the steer: the run is not over yet.
    await emitAndFlush(held.script, result());
    await settle();
    assert.equal(followUpSettled, false, 'the pushed turn is not settled while its steer is unread');
    assert.equal(followUp.frames.filter((frame) => frame.kind === 'complete').length, 0);

    // The CLI reads the steer in a follow-up turn of its own, then ends it.
    await emitAndFlush(held.script, init());
    await emitAndFlush(held.script, { type: 'user', isReplay: true, uuid: 'steer-1', session_id: NATIVE_ID, message: { role: 'user', content: 'also check the tests' } });
    await emitAndFlush(held.script, result());
    await waitFor(() => followUpSettled);
    assert.equal(followUp.frames.filter((frame) => frame.kind === 'complete').length, 1, 'one complete, after the steer was read');
    assert.equal(held.script.released(), false, 'and the shell keeps its process');

    // The shell reports back; nothing is left, so the process is let go.
    await emitAndFlush(held.script, taskCompleted());
    await emitAndFlush(held.script, result());
    await waitFor(() => held.script.released());
    held.script.end();
    await Promise.all([first.run, followUpRun]);
  } finally {
    held.script.end();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a release deferred for a pending native side question unpublishes the held process, so a new send starts its own', { concurrency: false }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-held-interplay-'));
  let rejectNative!: (error: unknown) => void;
  let nativeCalled = false;
  const held = createScriptedQuery(() => {
    nativeCalled = true;
    return new Promise((_resolve, reject) => { rejectNative = reject; });
  });
  const next = createScriptedQuery();
  const fork = forkQuery();
  try {
    const first = await startHeldRun(held.script, held.createQuery, cwd);

    // A native side question on the held process, still unanswered.
    const request: SideQuestionRequest = {
      appSessionId: SESSION_ID,
      providerSessionId: NATIVE_ID,
      projectPath: cwd,
      question: 'How far along is it?',
      model: null,
      signal: new AbortController().signal,
    };
    const asked = claudeRuntime.askSideQuestion(request, { delta: () => {} }, context(fork.createQuery));
    await waitFor(() => nativeCalled);

    // The shell reports back: the hold is over, but the release waits for the question.
    await emitAndFlush(held.script, taskCompleted());
    await emitAndFlush(held.script, result());
    await settle();
    assert.equal(held.script.released(), false, 'stdin stays open for the pending question');
    assert.equal(hasHeldTurn(SESSION_ID), false, 'but no follow-up may be pushed into it');

    // A new send therefore starts a process of its own and lets the old one go.
    const nextRun = queryClaudeSDK('next step', { sessionId: SESSION_ID, cwd }, recordingWriter().writer as never, context(next.createQuery));
    await waitFor(() => held.script.released());
    assert.equal(held.script.prompts(), 1, 'nothing was pushed into the held process');

    // The CLI cancels the question with its process; it is asked again on a fork.
    rejectNative(new Error('Side question cancelled'));
    const outcome = await asked;
    assert.equal(fork.calls(), 1);
    assert.equal(outcome.status, 'done');

    await emitAndFlush(next.script, init());
    await emitAndFlush(next.script, result());
    next.script.end();
    held.script.end();
    await Promise.all([first.run, nextRun]);
  } finally {
    next.script.end();
    held.script.end();
    await rm(cwd, { recursive: true, force: true });
  }
});
