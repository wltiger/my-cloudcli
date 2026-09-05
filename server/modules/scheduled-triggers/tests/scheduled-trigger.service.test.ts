import assert from 'node:assert/strict';
import test from 'node:test';

import { createScheduledTriggerService } from '@/modules/scheduled-triggers/services/scheduled-trigger.service.js';
import type { ScheduledTriggerRow } from '@/modules/database/index.js';
import type { ScheduledTriggerServiceDependencies } from '@/modules/scheduled-triggers/services/scheduled-trigger.service.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

function toSqliteTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function buildRow(overrides: Partial<ScheduledTriggerRow> = {}): ScheduledTriggerRow {
  return {
    id: 1,
    session_id: 'session-1',
    user_id: 42,
    trigger_at: toSqliteTimestamp(new Date(Date.now() - 60_000)),
    message_content: 'continue',
    status: 'pending',
    created_at: toSqliteTimestamp(new Date(Date.now() - 3_600_000)),
    fired_at: null,
    error: null,
    ...overrides,
  };
}

type CreateInput = Parameters<ScheduledTriggerServiceDependencies['db']['create']>[0];

/**
 * A fully-stubbed dependency set backed by a real in-memory status map (not
 * just recorded calls), so `claim()`/`listPendingDue()` behave exactly like
 * the real sqlite-backed repository — this is what lets the overlapping-poll
 * regression test below actually exercise the claim race, not just assert
 * against a stub that always says yes.
 */
function buildDeps(options: {
  pendingRows?: ScheduledTriggerRow[];
  isSessionProcessing?: () => boolean;
  runProvider?: ScheduledTriggerServiceDependencies['runProvider'];
  getSession?: ScheduledTriggerServiceDependencies['getSession'];
  graceWindowMs?: () => number;
  onCreate?: (input: CreateInput) => void;
} = {}) {
  const rows = new Map<number, ScheduledTriggerRow>();
  (options.pendingRows ?? []).forEach((row) => rows.set(row.id, { ...row }));

  const calls = {
    markSent: [] as number[],
    markFailed: [] as Array<{ id: number; error: string }>,
    markExpired: [] as number[],
    runProviderCount: 0,
    notify: [] as Array<{ code: string }>,
    broadcastSessionUpdated: [] as string[],
    broadcastPermissionFrame: [] as Array<Record<string, unknown>>,
  };

  const deps: ScheduledTriggerServiceDependencies = {
    db: {
      create: (input) => {
        options.onCreate?.(input);
        return buildRow({ message_content: input.messageContent });
      },
      listForSession: () => [...rows.values()],
      listPendingDue: () => [...rows.values()].filter((row) => row.status === 'pending'),
      claim: (id) => {
        const row = rows.get(id);
        if (!row || row.status !== 'pending') {
          return false;
        }
        row.status = 'firing';
        return true;
      },
      resetStuckFiring: () => {
        rows.forEach((row) => {
          if (row.status === 'firing') {
            row.status = 'pending';
          }
        });
      },
      markSent: (id) => {
        const row = rows.get(id);
        if (row) row.status = 'sent';
        calls.markSent.push(id);
      },
      markFailed: (id, error) => {
        const row = rows.get(id);
        if (row) row.status = 'failed';
        calls.markFailed.push({ id, error });
      },
      markExpired: (id) => {
        const row = rows.get(id);
        if (row) row.status = 'expired';
        calls.markExpired.push(id);
      },
      cancel: (id) => {
        const row = rows.get(id);
        if (!row || row.status !== 'pending') return false;
        row.status = 'cancelled';
        return true;
      },
    },
    getSession: options.getSession ?? (() => ({ provider: 'codex', project_path: '/workspace/demo', custom_name: null, permission_mode: null })),
    hasRuntime: () => true,
    runProvider: options.runProvider ?? (async () => {
      calls.runProviderCount += 1;
      return undefined;
    }),
    isSessionProcessing: options.isSessionProcessing ?? (() => false),
    notify: (input) => { calls.notify.push({ code: input.code }); },
    broadcastSessionUpdated: (sessionId) => { calls.broadcastSessionUpdated.push(sessionId); },
    broadcastPermissionFrame: (message) => { calls.broadcastPermissionFrame.push(message as Record<string, unknown>); },
    graceWindowMs: options.graceWindowMs ?? (() => ONE_HOUR_MS),
  };

  return { deps, calls, rows };
}

test('fireDueTriggers fires a due trigger and marks it sent', async () => {
  const row = buildRow();
  const { deps, calls } = buildDeps({ pendingRows: [row] });

  await createScheduledTriggerService(deps).fireDueTriggers(new Date());

  assert.deepEqual(calls.markSent, [row.id]);
  assert.equal(calls.runProviderCount, 1);
  assert.deepEqual(calls.broadcastSessionUpdated, [row.session_id]);
  assert.deepEqual(calls.notify.map((n) => n.code), ['scheduled_trigger.fired']);
});

test('fireDueTriggers expires a trigger overdue beyond the grace window without firing it', async () => {
  const row = buildRow({ trigger_at: toSqliteTimestamp(new Date(Date.now() - 2 * ONE_HOUR_MS)) });
  const { deps, calls } = buildDeps({ pendingRows: [row] });

  await createScheduledTriggerService(deps).fireDueTriggers(new Date());

  assert.deepEqual(calls.markExpired, [row.id]);
  assert.equal(calls.runProviderCount, 0);
  assert.deepEqual(calls.markSent, []);
});

test('fireDueTriggers fires a trigger just inside the grace window', async () => {
  const row = buildRow({ trigger_at: toSqliteTimestamp(new Date(Date.now() - (ONE_HOUR_MS - 60_000))) });
  const { deps, calls } = buildDeps({ pendingRows: [row] });

  await createScheduledTriggerService(deps).fireDueTriggers(new Date());

  assert.deepEqual(calls.markSent, [row.id]);
  assert.deepEqual(calls.markExpired, []);
});

test('fireDueTriggers skips a session that already has a run in progress, leaving it pending', async () => {
  const row = buildRow();
  const { deps, calls } = buildDeps({ pendingRows: [row], isSessionProcessing: () => true });

  await createScheduledTriggerService(deps).fireDueTriggers(new Date());

  assert.equal(calls.runProviderCount, 0);
  assert.deepEqual(calls.markSent, []);
  assert.deepEqual(calls.markExpired, []);
  assert.deepEqual(calls.markFailed, []);
});

test('fireDueTriggers marks a trigger failed when the provider run throws', async () => {
  const row = buildRow();
  const { deps, calls } = buildDeps({
    pendingRows: [row],
    runProvider: async () => { throw new Error('relay quota exhausted'); },
  });

  await createScheduledTriggerService(deps).fireDueTriggers(new Date());

  assert.equal(calls.markFailed.length, 1);
  assert.equal(calls.markFailed[0].id, row.id);
  assert.match(calls.markFailed[0].error, /relay quota exhausted/);
  assert.deepEqual(calls.notify.map((n) => n.code), ['scheduled_trigger.failed']);
});

test('fireDueTriggers does not fire the same trigger twice when a poll tick overlaps a still-running previous fire (regression)', async () => {
  const row = buildRow();
  let releaseFirstRun: (() => void) | undefined;
  const firstRunGate = new Promise<void>((resolve) => { releaseFirstRun = resolve; });
  let runCount = 0;

  const { deps, calls } = buildDeps({
    pendingRows: [row],
    runProvider: async () => {
      runCount += 1;
      if (runCount === 1) {
        // Simulate a provider call slower than the 30s poll interval: it's
        // still in flight when the "next" poll tick fires below.
        await firstRunGate;
      }
    },
  });
  const service = createScheduledTriggerService(deps);

  const firstTick = service.fireDueTriggers(new Date());
  // A second poll tick landing while the first is still awaiting the
  // provider call — this is exactly the setInterval race that used to
  // resend the message a second (or Nth) time.
  await service.fireDueTriggers(new Date());

  assert.equal(runCount, 1, 'the overlapping poll tick must not fire the provider a second time');

  releaseFirstRun?.();
  await firstTick;

  assert.deepEqual(calls.markSent, [row.id]);
  assert.equal(calls.runProviderCount, 0, 'the overlapping tick never reached the default counting runProvider');
});

test('recoverStuckTriggers resets a trigger left `firing` by a crash back to `pending`', async () => {
  const row = buildRow({ status: 'firing' as ScheduledTriggerRow['status'] });
  const { deps, rows } = buildDeps({ pendingRows: [row] });
  const service = createScheduledTriggerService(deps);

  service.recoverStuckTriggers();

  assert.equal(rows.get(row.id)?.status, 'pending');
});

test('createScheduledTrigger rejects a triggerAt that is not in the future', () => {
  const { deps } = buildDeps();
  const service = createScheduledTriggerService(deps);

  assert.throws(
    () => service.createScheduledTrigger({
      sessionId: 'session-1',
      userId: 42,
      triggerAt: new Date(Date.now() - 1000),
    }),
    /future/,
  );
});

test('createScheduledTrigger rejects an unknown session', () => {
  const { deps } = buildDeps({ getSession: () => null });
  const service = createScheduledTriggerService(deps);

  assert.throws(
    () => service.createScheduledTrigger({
      sessionId: 'missing-session',
      userId: 42,
      triggerAt: new Date(Date.now() + 60_000),
    }),
    /was not found/,
  );
});

test('createScheduledTrigger defaults the message to "continue" when blank', () => {
  let created: CreateInput | undefined;
  const { deps } = buildDeps({ onCreate: (input) => { created = input; } });

  createScheduledTriggerService(deps).createScheduledTrigger({
    sessionId: 'session-1',
    userId: 42,
    triggerAt: new Date(Date.now() + 60_000),
    messageContent: '   ',
  });

  assert.ok(created);
  assert.equal(created.messageContent, 'continue');
});

test('fireDueTriggers inherits the permission mode stored on the session row', async () => {
  const row = buildRow();
  let capturedOptions: Record<string, unknown> | undefined;
  const { deps } = buildDeps({
    pendingRows: [row],
    getSession: () => ({ provider: 'claude', project_path: '/workspace/demo', custom_name: null, permission_mode: 'acceptEdits' }),
    runProvider: async (_provider, _command, options) => { capturedOptions = options as Record<string, unknown>; },
  });

  await createScheduledTriggerService(deps).fireDueTriggers(new Date());

  assert.equal(capturedOptions?.permissionMode, 'acceptEdits');
});

test('fireDueTriggers passes no permissionMode when the session row has none stored', async () => {
  const row = buildRow();
  let capturedOptions: Record<string, unknown> | undefined;
  const { deps } = buildDeps({
    pendingRows: [row],
    getSession: () => ({ provider: 'claude', project_path: '/workspace/demo', custom_name: null, permission_mode: null }),
    runProvider: async (_provider, _command, options) => { capturedOptions = options as Record<string, unknown>; },
  });

  await createScheduledTriggerService(deps).fireDueTriggers(new Date());

  assert.ok(capturedOptions);
  assert.equal('permissionMode' in capturedOptions, false);
});

test('the headless writer relays permission frames to clients under the app session id and drops everything else', async () => {
  const row = buildRow();
  const { deps, calls } = buildDeps({
    pendingRows: [row],
    runProvider: async (_provider, _command, _options, writer) => {
      const frame = {
        id: 'msg-1',
        kind: 'permission_request',
        requestId: 'req-1',
        toolName: 'Bash',
        input: { command: 'npm test' },
        // The runtime labels frames with the provider-native id once it
        // learns it; clients only know the app session id.
        sessionId: 'provider-native-1',
        provider: 'claude',
        timestamp: '2026-09-05T00:00:00.000Z',
      };
      writer.send(frame);
      writer.send({ ...frame, kind: 'text', content: 'working...' });
      writer.send({ ...frame, kind: 'permission_cancelled', reason: 'timeout' });
    },
  });

  await createScheduledTriggerService(deps).fireDueTriggers(new Date());

  assert.equal(calls.broadcastPermissionFrame.length, 2);
  for (const frame of calls.broadcastPermissionFrame) {
    assert.equal(frame.sessionId, row.session_id);
  }
  assert.equal(calls.broadcastPermissionFrame[0].kind, 'permission_request');
  assert.equal(calls.broadcastPermissionFrame[0].requestId, 'req-1');
  assert.equal(calls.broadcastPermissionFrame[1].kind, 'permission_cancelled');
});
