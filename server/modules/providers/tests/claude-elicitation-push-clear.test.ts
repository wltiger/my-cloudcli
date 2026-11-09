import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ElicitationRequest, ElicitationResult } from '@anthropic-ai/claude-agent-sdk';

import type { AnyRecord, NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * Seam: the `onElicitation` callback `queryClaudeSDK` hands the SDK, answered
 * through `resolveToolApproval` like any permission request. Fork entry 16
 * clears a resolved request's push notification on every device; that needs
 * the user the request belongs to, which a tool approval records and an MCP
 * elicitation must record too.
 */

type OnElicitation = (request: ElicitationRequest, options: { signal: AbortSignal; requestId: string }) => Promise<ElicitationResult>;

test('answering an MCP elicitation clears its push notification on every device, like a tool approval', async (t) => {
  const resolved: AnyRecord[] = [];
  // Mocked one level below the notifications barrel, which the runtime imports.
  t.mock.module('@/modules/notifications/services/notification-orchestrator.service.js', {
    namedExports: {
      buildNotificationPayload: () => ({}),
      createNotificationEvent: (event: AnyRecord) => event,
      notifyUserIfEnabled: () => {},
      notifyRunStopped: () => {},
      notifyRunFailed: () => {},
      notifyPermissionResolved: (payload: AnyRecord) => {
        resolved.push(payload);
      },
      notifyBackgroundWorkCompleted: () => {},
    },
  });

  const { queryClaudeSDK, resolveToolApproval } = await import('@/modules/providers/list/claude/claude-runtime.provider.js');
  const { CLAUDE_PREDEFINED_MODELS } = await import('@/modules/providers/list/claude/claude-models.provider.js');

  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-elicitation-push-'));
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: 'user-7' };
  let captured: OnElicitation | null = null;
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => { finish = resolve; });

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ options }) => {
    captured = (options as { onElicitation?: OnElicitation }).onElicitation ?? null;
    const iterator = (async function* () {
      await finished;
      yield* [] as Record<string, unknown>[];
    })();
    return Object.assign(iterator, { interrupt: async () => {}, stopTask: async () => {} });
  };
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
    createQuery,
  };

  try {
    const done = queryClaudeSDK('hello', { sessionId: 'app-elicitation-push', cwd }, writer as never, context);
    for (let attempt = 0; attempt < 200 && !captured; attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    assert.ok(captured, 'queryClaudeSDK passed no onElicitation to the SDK');

    const pending = (captured as OnElicitation)(
      { serverName: 'demo', message: 'Pick a name', mode: 'form', requestedSchema: { type: 'object', properties: {} } } as ElicitationRequest,
      { signal: new AbortController().signal, requestId: 'ctl-1' },
    );
    for (let attempt = 0; attempt < 200 && !sent.some((message) => message.kind === 'permission_request'); attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 5); });
    }
    const request = sent.find((message) => message.kind === 'permission_request');
    assert.ok(request, 'the elicitation reached the client');

    resolveToolApproval(request.requestId as string, { allow: false });
    await pending;

    assert.equal(resolved.length, 1, 'the resolution is announced once');
    assert.equal(resolved[0]?.userId, 'user-7', 'for the user the request belongs to, so every device clears it');
    assert.equal(resolved[0]?.requestId, request.requestId);

    finish();
    await done;
  } finally {
    finish();
    await rm(cwd, { recursive: true, force: true });
  }
});
