import { getConnection } from '@/modules/database/connection.js';

export type ScheduledTriggerStatus = 'pending' | 'firing' | 'sent' | 'failed' | 'expired' | 'cancelled';

export type ScheduledTriggerRow = {
  id: number;
  session_id: string;
  user_id: number | null;
  trigger_at: string;
  message_content: string;
  status: ScheduledTriggerStatus;
  created_at: string;
  fired_at: string | null;
  error: string | null;
};

function toSqliteTimestamp(date: Date): string {
  // SQLite's own CURRENT_TIMESTAMP writes UTC "YYYY-MM-DD HH:MM:SS"; matching
  // that format keeps plain string comparisons (`trigger_at <= ?`) correct.
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function getByIdRow(id: number): ScheduledTriggerRow | null {
  const db = getConnection();
  const row = db.prepare(`SELECT * FROM scheduled_triggers WHERE id = ?`).get(id) as
    | ScheduledTriggerRow
    | undefined;

  return row ?? null;
}

export const scheduledTriggersDb = {
  /** Creates a new pending trigger, cancelling any pending trigger already queued for this session. */
  create(input: {
    sessionId: string;
    userId: number | string | null;
    triggerAt: Date;
    messageContent: string;
  }): ScheduledTriggerRow {
    const db = getConnection();

    db.prepare(`
      UPDATE scheduled_triggers SET status = 'cancelled'
      WHERE session_id = ? AND status = 'pending'
    `).run(input.sessionId);

    const result = db.prepare(`
      INSERT INTO scheduled_triggers (session_id, user_id, trigger_at, message_content, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(input.sessionId, input.userId ?? null, toSqliteTimestamp(input.triggerAt), input.messageContent);

    return getByIdRow(Number(result.lastInsertRowid)) as ScheduledTriggerRow;
  },

  getById(id: number): ScheduledTriggerRow | null {
    return getByIdRow(id);
  },

  listForSession(sessionId: string): ScheduledTriggerRow[] {
    const db = getConnection();
    return db.prepare(`
      SELECT * FROM scheduled_triggers WHERE session_id = ? ORDER BY created_at DESC
    `).all(sessionId) as ScheduledTriggerRow[];
  },

  /** Pending triggers whose time has come, regardless of how overdue — callers decide the grace window. */
  listPendingDue(now: Date): ScheduledTriggerRow[] {
    const db = getConnection();
    return db.prepare(`
      SELECT * FROM scheduled_triggers WHERE status = 'pending' AND trigger_at <= ?
    `).all(toSqliteTimestamp(now)) as ScheduledTriggerRow[];
  },

  /**
   * Atomically claims a pending trigger before firing it, flipping it to
   * `firing`. Returns false if it's no longer `pending` (already claimed by
   * an overlapping poll tick, cancelled, etc.) — the caller must not fire it.
   * This is what actually prevents a slow provider call (longer than one
   * poll interval) from causing the same trigger to fire more than once.
   */
  claim(id: number): boolean {
    const db = getConnection();
    const result = db.prepare(`
      UPDATE scheduled_triggers SET status = 'firing' WHERE id = ? AND status = 'pending'
    `).run(id);
    return result.changes > 0;
  },

  /** Resets any trigger stuck in `firing` (server crashed mid-fire) back to `pending` for a later poll to retry. */
  resetStuckFiring(): void {
    const db = getConnection();
    db.prepare(`
      UPDATE scheduled_triggers SET status = 'pending' WHERE status = 'firing'
    `).run();
  },

  markSent(id: number): void {
    const db = getConnection();
    db.prepare(`
      UPDATE scheduled_triggers SET status = 'sent', fired_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
  },

  markFailed(id: number, errorMessage: string): void {
    const db = getConnection();
    db.prepare(`
      UPDATE scheduled_triggers SET status = 'failed', fired_at = CURRENT_TIMESTAMP, error = ? WHERE id = ?
    `).run(errorMessage, id);
  },

  markExpired(id: number): void {
    const db = getConnection();
    db.prepare(`
      UPDATE scheduled_triggers SET status = 'expired', fired_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
  },

  /** Cancels a pending trigger; a no-op (returns false) once it's no longer pending. */
  cancel(id: number): boolean {
    const db = getConnection();
    const result = db.prepare(`
      UPDATE scheduled_triggers SET status = 'cancelled' WHERE id = ? AND status = 'pending'
    `).run(id);
    return result.changes > 0;
  },
};
