import { scheduledTriggersDb, sessionsDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { providerRuntimeService } from '@/modules/providers/index.js';
import { chatRunRegistry, connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import type { AnyRecord, LLMProvider, ProviderRuntimeWriter } from '@/shared/types.js';
import type { ScheduledTriggerRow } from '@/modules/database/index.js';

const DEFAULT_GRACE_WINDOW_MINUTES = 60;

type SessionLookup = {
  provider: string;
  project_path: string | null;
  custom_name: string | null;
} | null;

type NotifyInput = {
  userId: number | null;
  provider: string;
  sessionId: string;
  kind: string;
  code: string;
  meta: Record<string, unknown>;
  severity: string;
  dedupeKey: string;
};

export type ScheduledTriggerServiceDependencies = {
  db: {
    create(input: { sessionId: string; userId: number | string | null; triggerAt: Date; messageContent: string }): ScheduledTriggerRow;
    listForSession(sessionId: string): ScheduledTriggerRow[];
    listPendingDue(now: Date): ScheduledTriggerRow[];
    claim(id: number): boolean;
    resetStuckFiring(): void;
    markSent(id: number): void;
    markFailed(id: number, errorMessage: string): void;
    markExpired(id: number): void;
    cancel(id: number): boolean;
  };
  getSession(sessionId: string): SessionLookup;
  hasRuntime(provider: string): boolean;
  runProvider(provider: LLMProvider, command: string, options: AnyRecord, writer: ProviderRuntimeWriter): Promise<unknown>;
  isSessionProcessing(sessionId: string): boolean;
  notify(input: NotifyInput): void;
  broadcastSessionUpdated(sessionId: string): void;
  graceWindowMs(): number;
};

/**
 * How late a missed trigger (server was down at `trigger_at`) may still fire
 * once the poller resumes. Configurable per the product decision that this
 * value must not be a hardcoded magic number.
 */
function getGraceWindowMs(): number {
  const configured = Number(process.env.SCHEDULED_TRIGGER_GRACE_WINDOW_MINUTES);
  const minutes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_GRACE_WINDOW_MINUTES;
  return minutes * 60 * 1000;
}

/**
 * Pings every connected client that a session changed. This only refreshes
 * sidebar metadata (`session_upserted` is explicitly sidebar-only on the
 * frontend) — an already-open chat pane will not live-stream the fired
 * message. Full live-streaming into an open tab is a follow-up, not v1.
 */
function broadcastSessionUpdated(sessionId: string): void {
  const payload = JSON.stringify({
    kind: 'session_upserted',
    sessionId,
    timestamp: new Date().toISOString(),
  });

  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
}

const defaultDependencies: ScheduledTriggerServiceDependencies = {
  db: scheduledTriggersDb,
  getSession: (sessionId) => sessionsDb.getSessionById(sessionId) as SessionLookup,
  hasRuntime: (provider) => providerRuntimeService.hasRuntime(provider),
  runProvider: (provider, command, options, writer) => providerRuntimeService.run(provider, command, options, writer),
  isSessionProcessing: (sessionId) => chatRunRegistry.isProcessing(sessionId),
  notify: ({ userId, provider, sessionId, kind, code, meta, severity, dedupeKey }) => {
    notifyUserIfEnabled({
      userId,
      // createNotificationEvent is a plain JS module; its defaulted
      // destructured params (`sessionId = null`, etc.) infer too narrow for
      // TS to accept real string arguments here.
      event: createNotificationEvent({ provider, sessionId, kind, code, meta, severity, dedupeKey } as any),
    });
  },
  broadcastSessionUpdated,
  graceWindowMs: getGraceWindowMs,
};

/**
 * Creates the scheduled-trigger service. Production code uses the exported
 * `scheduledTriggerService` singleton; tests inject fakes for `db`,
 * `runProvider`, etc. to exercise the due/grace-window/in-progress logic
 * without touching real provider CLIs, sqlite, or WebSocket clients.
 */
export function createScheduledTriggerService(
  overrides: Partial<ScheduledTriggerServiceDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };

  function buildHeadlessWriter(userId: number | null) {
    return {
      // Headless: no live client is attached, so nothing needs to receive
      // stream events. The provider's own session file is the record of truth.
      send: () => {},
      setSessionId: () => {},
      userId,
    };
  }

  async function fireTrigger(row: ScheduledTriggerRow): Promise<void> {
    const session = deps.getSession(row.session_id);
    if (!session) {
      deps.db.markFailed(row.id, `Session "${row.session_id}" no longer exists.`);
      return;
    }

    const provider = session.provider as LLMProvider;
    if (!deps.hasRuntime(provider)) {
      deps.db.markFailed(row.id, `Provider "${provider}" is not available.`);
      return;
    }

    const runtimeOptions: AnyRecord = {
      sessionId: row.session_id,
      cwd: session.project_path ?? undefined,
      projectPath: session.project_path ?? undefined,
    };

    try {
      await deps.runProvider(provider, row.message_content, runtimeOptions, buildHeadlessWriter(row.user_id));
      deps.db.markSent(row.id);
      deps.broadcastSessionUpdated(row.session_id);
      deps.notify({
        userId: row.user_id,
        provider,
        sessionId: row.session_id,
        kind: 'info',
        code: 'scheduled_trigger.fired',
        meta: { sessionName: session.custom_name || null },
        severity: 'info',
        dedupeKey: `scheduled-trigger:${row.id}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.db.markFailed(row.id, message);
      deps.notify({
        userId: row.user_id,
        provider,
        sessionId: row.session_id,
        kind: 'error',
        code: 'scheduled_trigger.failed',
        meta: { error: message, sessionName: session.custom_name || null },
        severity: 'error',
        dedupeKey: `scheduled-trigger:${row.id}`,
      });
    }
  }

  /**
   * Polling entry point: fires every pending trigger whose time has come,
   * expiring anything stale beyond the grace window and skipping (for a
   * later poll) any session that already has a run in progress right now.
   */
  async function fireDueTriggers(now: Date = new Date()): Promise<void> {
    const due = deps.db.listPendingDue(now);
    const graceWindowMs = deps.graceWindowMs();

    for (const row of due) {
      const triggerAtMs = new Date(`${row.trigger_at.replace(' ', 'T')}Z`).getTime();
      const overdueMs = now.getTime() - triggerAtMs;
      if (overdueMs > graceWindowMs) {
        deps.db.markExpired(row.id);
        continue;
      }

      if (deps.isSessionProcessing(row.session_id)) {
        continue;
      }

      // Claim before firing: flips pending -> firing so an overlapping poll
      // tick (this provider call outliving the 30s poll interval) sees the
      // row is no longer pending and skips it, instead of firing it again.
      if (!deps.db.claim(row.id)) {
        continue;
      }

      await fireTrigger(row);
    }
  }

  /** Recovers triggers stuck `firing` from a crash mid-fire, so they're eligible to be claimed again. Call once at boot, before polling starts. */
  function recoverStuckTriggers(): void {
    deps.db.resetStuckFiring();
  }

  function createScheduledTrigger(input: {
    sessionId: string;
    userId: number | null;
    triggerAt: Date;
    messageContent?: string;
  }): ScheduledTriggerRow {
    const session = deps.getSession(input.sessionId);
    if (!session) {
      throw new Error(`Session "${input.sessionId}" was not found.`);
    }
    if (input.triggerAt.getTime() <= Date.now()) {
      throw new Error('triggerAt must be in the future.');
    }

    return deps.db.create({
      sessionId: input.sessionId,
      userId: input.userId,
      triggerAt: input.triggerAt,
      messageContent: input.messageContent?.trim() || 'continue',
    });
  }

  function listScheduledTriggersForSession(sessionId: string): ScheduledTriggerRow[] {
    return deps.db.listForSession(sessionId);
  }

  function cancelScheduledTrigger(id: number): boolean {
    return deps.db.cancel(id);
  }

  return {
    fireDueTriggers,
    recoverStuckTriggers,
    createScheduledTrigger,
    listScheduledTriggersForSession,
    cancelScheduledTrigger,
  };
}

export const scheduledTriggerService = createScheduledTriggerService();
