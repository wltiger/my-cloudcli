import fsSync from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import {
  getOpenCodeDatabasePath,
  normalizeProviderTimestamp,
  normalizeSessionName,
  readJsonRecord,
  readOptionalString,
  unwrapJsonStringLiteral,
} from '@/shared/utils.js';

type OpenCodeSessionRow = {
  id: string;
  directory: string | null;
  title: string | null;
  time_created: number | null;
  time_updated: number | null;
  worktree: string | null;
};

type SynchronizeRowsResult = {
  processed: number;
  firstSessionId: string | null;
};

/**
 * Session indexer for OpenCode's SQLite-backed session store.
 */
export class OpenCodeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'opencode' as const;

  /**
   * Scans OpenCode's shared opencode.db and upserts active sessions into DB,
   * then drops the rows of sessions opencode.db no longer has.
   */
  async synchronize(since?: Date): Promise<number> {
    const result = this.synchronizeRows(since);
    // Independent of `since`: every scan after the first one carries a cursor,
    // and sessions deleted in OpenCode never move past it.
    await this.pruneDeletedSessions();
    return result.processed;
  }

  /**
   * Handles watcher changes for opencode.db.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (path.basename(filePath) !== 'opencode.db') {
      return null;
    }

    const result = this.synchronizeRows(undefined, 1);
    return result.firstSessionId;
  }

  private synchronizeRows(since?: Date, limit?: number): SynchronizeRowsResult {
    const dbPath = getOpenCodeDatabasePath();
    if (!fsSync.existsSync(dbPath)) {
      return { processed: 0, firstSessionId: null };
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const sinceMillis = since?.getTime() ?? null;
      const limitClause = limit ? 'LIMIT ?' : '';
      const params = limit ? [sinceMillis, sinceMillis, limit] : [sinceMillis, sinceMillis];
      const rows = db.prepare(`
        SELECT
          s.id AS id,
          s.directory AS directory,
          s.title AS title,
          s.time_created AS time_created,
          s.time_updated AS time_updated,
          p.worktree AS worktree
        FROM session s
        LEFT JOIN project p ON p.id = s.project_id
        WHERE s.time_archived IS NULL
          AND (? IS NULL OR COALESCE(s.time_updated, s.time_created, 0) >= ?)
        ORDER BY COALESCE(s.time_updated, s.time_created, 0) DESC, s.id DESC
        ${limitClause}
      `).all(...params) as OpenCodeSessionRow[];

      let processed = 0;
      let firstSessionId: string | null = null;
      for (const row of rows) {
        const indexedSessionId = this.upsertSession(db, row);
        if (!indexedSessionId) {
          continue;
        }

        if (!firstSessionId) {
          firstSessionId = indexedSessionId;
        }
        processed += 1;
      }

      return { processed, firstSessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[OpenCodeProvider] Failed to synchronize sessions:', message);
      return { processed: 0, firstSessionId: null };
    } finally {
      db.close();
    }
  }

  /**
   * Drops the rows of sessions deleted from OpenCode outside CloudCLI.
   *
   * The generic orphan prune cannot see them: their `jsonl_path` is null on
   * purpose (see `upsertSession`). Judged against every id in `session`,
   * archived ones included — the upsert's `time_archived IS NULL` filter would
   * read a session archived in OpenCode as deleted. An unreadable database
   * skips the whole round.
   */
  private async pruneDeletedSessions(): Promise<void> {
    // Imported here, not at the top: the websocket module reaches the provider
    // registry, which constructs this class while it loads. Awaited before the
    // ids are read so nothing can interleave between reading them and deleting:
    // the runtime maps a provider id onto its app row as soon as OpenCode
    // reports it, possibly before OpenCode has committed that session.
    // A throw here would otherwise reject `synchronize()` and take the whole
    // round's pruning down with it, this provider's and the generic one's.
    let chatRunRegistry: typeof import('@/modules/websocket/index.js')['chatRunRegistry'];
    try {
      ({ chatRunRegistry } = await import('@/modules/websocket/index.js'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[OpenCodeProvider] Skipped pruning deleted sessions:', message);
      return;
    }

    const dbPath = getOpenCodeDatabasePath();
    if (!fsSync.existsSync(dbPath)) {
      return;
    }

    let sessionIds: Set<string>;
    let databaseModifiedAt: number;
    try {
      // Taken before the snapshot, so a row written while it is read counts as
      // newer than it rather than being judged by it.
      const walPath = `${dbPath}-wal`;
      databaseModifiedAt = Math.max(
        fsSync.statSync(dbPath).mtimeMs,
        fsSync.existsSync(walPath) ? fsSync.statSync(walPath).mtimeMs : 0,
      );

      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        const rows = db.prepare('SELECT id FROM session').all() as Array<{ id: string }>;
        sessionIds = new Set(rows.map((row) => row.id));
      } finally {
        db.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[OpenCodeProvider] Skipped pruning deleted sessions:', message);
      return;
    }

    this.pruneRows(sessionIds, databaseModifiedAt, chatRunRegistry);
  }

  /**
   * The judging-and-deleting half of `pruneDeletedSessions`, deliberately
   * synchronous.
   *
   * Nothing may be awaited between reading the ids and deleting the rows: the
   * runtime binds a provider id onto its app row from another module, and a
   * yield here would let a row be bound after this snapshot and then deleted
   * for an id the snapshot never saw. A non-async signature is what keeps that
   * true, so do not make this method async to add a broadcast or a log.
   */
  private pruneRows(
    sessionIds: Set<string>,
    databaseModifiedAt: number,
    chatRunRegistry: typeof import('@/modules/websocket/index.js')['chatRunRegistry'],
  ): void {
    try {
      let pruned = 0;
      const rows = [...sessionsDb.getAllSessions(), ...sessionsDb.getArchivedSessions()]
        .filter((row) => row.provider === this.provider);
      for (const row of rows) {
        const providerSessionId = readOptionalString(row.provider_session_id);
        if (!providerSessionId || chatRunRegistry.getRun(row.session_id)) {
          continue;
        }

        // A row touched after the database last changed was not judged by this
        // snapshot. That is the case when OpenCode writes somewhere else than
        // the path read here (`getOpenCodeDatabasePath` ignores `XDG_DATA_HOME`).
        if (Date.parse(row.updated_at) > databaseModifiedAt) {
          continue;
        }

        if (!sessionIds.has(providerSessionId) && sessionsDb.deleteSessionById(row.session_id)) {
          pruned += 1;
        }
      }

      if (pruned > 0) {
        console.log(`[OpenCodeProvider] Pruned ${pruned} session(s) deleted in OpenCode`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[OpenCodeProvider] Failed to prune deleted sessions:', message);
    }
  }

  private upsertSession(db: Database.Database, row: OpenCodeSessionRow): string | null {
    const sessionId = readOptionalString(row.id);
    const projectPath = readOptionalString(row.directory) ?? readOptionalString(row.worktree);
    if (!sessionId || !projectPath) {
      return null;
    }

    const fallbackTitle = 'Untitled OpenCode Session';
    const pendingAppSession = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId)
      ?? sessionsDb.findLatestPendingAppSession(this.provider, projectPath);
    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      // Slow networks can let the sqlite watcher index opencode.db before the
      // runtime reports its provider id back through the websocket mapping.
      // Bind that id to the fresh app row first so the watcher does not create
      // a temporary provider-id sidebar entry for the same session.
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, sessionId);
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId);
    const existingName = existingSession?.custom_name;

    let nextName: string | undefined;
    if (existingName && existingName !== fallbackTitle) {
      nextName = existingName;
    } else {
      nextName = readOptionalString(row.title) ?? this.readFirstUserText(db, sessionId);
    }

    // OpenCode stores every session in one shared sqlite database, so jsonl_path
    // must stay null to avoid deleting opencode.db when one app session is removed.
    // Return the canonical stored row id so watcher-triggered sidebar updates
    // stay on the app session once provider_session_id has already been mapped.
    return sessionsDb.createSession(
      sessionId,
      this.provider,
      projectPath,
      normalizeSessionName(nextName, fallbackTitle),
      normalizeProviderTimestamp(row.time_created),
      normalizeProviderTimestamp(row.time_updated ?? row.time_created),
      null,
    );
  }

  private readFirstUserText(db: Database.Database, sessionId: string): string | undefined {
    try {
      const row = db.prepare(`
        SELECT p.data AS data
        FROM message m
        INNER JOIN part p
          ON p.session_id = m.session_id
         AND p.message_id = m.id
        WHERE m.session_id = ?
          AND json_extract(m.data, '$.role') = 'user'
          AND json_extract(p.data, '$.type') = 'text'
        ORDER BY COALESCE(m.time_created, 0), COALESCE(p.time_created, 0)
        LIMIT 1
      `).get(sessionId) as { data: string | null } | undefined;

      const data = readJsonRecord(row?.data);
      const text = readOptionalString(data?.text);
      // OpenCode persists the first prompt as a JSON string literal (e.g.
      // `"hello"`), so decode it to avoid titling the session with quotes.
      return text === undefined ? undefined : unwrapJsonStringLiteral(text);
    } catch {
      return undefined;
    }
  }
}
