import fsSync from 'node:fs';

import Database from 'better-sqlite3';

import { parseFilesInputTag, parseImagesInputTag } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  getOpenCodeDatabasePath,
  normalizeProviderTimestamp,
  readObjectRecord,
  readJsonRecord,
  readOptionalString,
  sliceTailPage,
  unwrapJsonStringLiteral,
} from '@/shared/utils.js';

import { buildOpenCodeAnchorIndex } from './opencode-anchors.js';
import { buildOpenCodeRewindAnchorIndex, filterOpenCodeRevertedRows } from './opencode-rewind.js';
import { forkOpenCodeSession } from './opencode-runtime.provider.js';

const PROVIDER = 'opencode';

type OpenCodeHistoryRow = {
  message_id: string;
  message_time_created: number | null;
  message_data: string | null;
  part_id: string | null;
  part_time_created: number | null;
  part_data: string | null;
};

type OpenCodeTokenTotals = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

const openOpenCodeDatabase = (): Database.Database | null => {
  const dbPath = getOpenCodeDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    return null;
  }

  return new Database(dbPath, { readonly: true, fileMustExist: true });
};

/**
 * The message id this session was Rewound at, or null when it is not reverted.
 *
 * A Rewind on OpenCode is a server-side revert, and OpenCode records it as one
 * column on the session row rather than by removing anything: every message it
 * reverted stays in `message`/`part` and its own read API still returns them
 * all (measured against 1.18.18). The column holds `{messageID, snapshot,
 * diff}` and has been part of the base `session` schema, so it is read without
 * the `PRAGMA table_info` guard the token counters need.
 */
const readOpenCodeRevertedMessageId = (
  db: Database.Database,
  sessionId: string,
): string | null => {
  const row = db.prepare('SELECT revert FROM session WHERE id = ?').get(sessionId) as
    | { revert: string | null }
    | undefined;
  return readOptionalString(readJsonRecord(row?.revert)?.messageID) ?? null;
};

const formatToolContent = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const extractText = (value: unknown): string => {
  if (typeof value === 'string') {
    return unwrapJsonStringLiteral(value);
  }

  const record = readObjectRecord(value);
  const text = readOptionalString(record?.text)
    ?? readOptionalString(record?.content)
    ?? '';
  return unwrapJsonStringLiteral(text);
};

const hasUserRole = (value: unknown): boolean => {
  const record = readObjectRecord(value);
  return readOptionalString(record?.role) === 'user';
};

const isUserTextEcho = (raw: AnyRecord): boolean => {
  return readOptionalString(raw.role) === 'user'
    || hasUserRole(raw.message)
    || hasUserRole(raw.part);
};

const buildTokenUsage = (totals: OpenCodeTokenTotals | undefined): AnyRecord | undefined => {
  if (!totals) {
    return undefined;
  }

  const inputTokens = totals.inputTokens;
  const displayInputTokens = inputTokens + totals.cacheReadTokens;
  const outputTokens = totals.outputTokens;
  const used = inputTokens
    + outputTokens
    + totals.reasoningTokens
    + totals.cacheReadTokens
    + totals.cacheWriteTokens;

  if (used <= 0) {
    return undefined;
  }

  return {
    used,
    inputTokens: displayInputTokens,
    outputTokens,
    breakdown: {
      input: displayInputTokens,
      output: outputTokens,
    },
  };
};

const readOpenCodeSessionColumnTokenUsage = (
  db: Database.Database,
  sessionId: string,
): AnyRecord | undefined => {
  const columns = db.prepare('PRAGMA table_info(session)').all() as { name: string }[];
  const columnNames = new Set(columns.map((column) => column.name));
  const requiredColumns = ['tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write'];
  if (!requiredColumns.every((column) => columnNames.has(column))) {
    return undefined;
  }

  const row = db.prepare(`
    SELECT
      tokens_input AS inputTokens,
      tokens_output AS outputTokens,
      tokens_reasoning AS reasoningTokens,
      tokens_cache_read AS cacheReadTokens,
      tokens_cache_write AS cacheWriteTokens
    FROM session
    WHERE id = ?
  `).get(sessionId) as OpenCodeTokenTotals | undefined;

  if (!row) {
    return undefined;
  }

  return buildTokenUsage({
    inputTokens: Number(row.inputTokens ?? 0),
    outputTokens: Number(row.outputTokens ?? 0),
    reasoningTokens: Number(row.reasoningTokens ?? 0),
    cacheReadTokens: Number(row.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(row.cacheWriteTokens ?? 0),
  });
};

/**
 * OpenCode stores per-message token counts on assistant `message.data` objects
 * (see MessageV2.Assistant). Older DBs also had session-level counters; this
 * matches current `opencode.db` layouts that only persist message JSON.
 */
const aggregateOpenCodeSessionTokenUsage = (
  db: Database.Database,
  sessionId: string,
): AnyRecord | undefined => {
  const sessionColumnUsage = readOpenCodeSessionColumnTokenUsage(db, sessionId);
  if (sessionColumnUsage) {
    return sessionColumnUsage;
  }

  const rows = db.prepare('SELECT data FROM message WHERE session_id = ?').all(sessionId) as { data: string }[];

  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  for (const row of rows) {
    const info = readJsonRecord(row.data);
    if (readOptionalString(info?.role) !== 'assistant') {
      continue;
    }

    const tokens = readObjectRecord(info?.tokens);
    if (!tokens) {
      continue;
    }

    inputTokens += Number(tokens.input ?? 0);
    outputTokens += Number(tokens.output ?? 0);
    reasoningTokens += Number(tokens.reasoning ?? 0);
    const cache = readObjectRecord(tokens.cache);
    cacheReadTokens += Number(cache?.read ?? 0);
    cacheWriteTokens += Number(cache?.write ?? 0);
  }

  return buildTokenUsage({
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });
};

export class OpenCodeSessionsProvider implements IProviderSessions {
  /**
   * Normalizes live `opencode run --format json` events into frontend messages.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    const type = readOptionalString(raw.type) ?? readOptionalString(raw.event);
    const eventSessionId = readOptionalString(raw.sessionID) ?? readOptionalString(raw.sessionId) ?? sessionId;
    const timestamp = normalizeProviderTimestamp(raw.time ?? raw.timestamp);
    const baseId = readOptionalString(raw.id)
      ?? readOptionalString(raw.messageID)
      ?? generateMessageId('opencode');

    if (type === 'text') {
      // The client already renders an optimistic user bubble, so provider user
      // echoes must not be streamed back as assistant text.
      if (isUserTextEcho(raw)) {
        return [];
      }

      const content = extractText(raw.text ?? raw.delta ?? raw.message);
      if (!content.trim()) {
        return [];
      }

      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'stream_delta',
        content,
      })];
    }

    if (type === 'reasoning') {
      const content = extractText(raw.text ?? raw.delta ?? raw.message);
      if (!content.trim()) {
        return [];
      }

      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'thinking',
        content,
      })];
    }

    if (type === 'tool_use') {
      const toolName = readOptionalString(raw.tool) ?? readOptionalString(raw.name) ?? 'Tool';
      const toolId = readOptionalString(raw.callID) ?? readOptionalString(raw.toolCallId) ?? baseId;
      const toolMessage = createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName,
        toolInput: raw.input ?? raw.arguments ?? {},
        toolId,
      });

      if (raw.output !== undefined || raw.error !== undefined) {
        toolMessage.toolResult = {
          content: formatToolContent(raw.output ?? raw.error),
          isError: raw.error !== undefined,
        };
      }

      return [toolMessage];
    }

    if (type === 'error') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'error',
        content: readOptionalString(raw.error) ?? readOptionalString(raw.message) ?? 'Unknown OpenCode error',
      })];
    }

    if (type === 'step_finish') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'stream_end',
      })];
    }

    return [];
  }

  /**
   * Loads OpenCode history from the shared SQLite session database.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    // OpenCode's shared sqlite database keys messages by the provider-native
    // session id, not the app-facing id this method is addressed with.
    const providerSessionId = options.providerSessionId ?? sessionId;
    const db = openOpenCodeDatabase();
    if (!db) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    try {
      const rows = db.prepare(`
        SELECT
          m.id AS message_id,
          m.time_created AS message_time_created,
          m.data AS message_data,
          p.id AS part_id,
          p.time_created AS part_time_created,
          p.data AS part_data
        FROM message m
        LEFT JOIN part p
          ON p.session_id = m.session_id
         AND p.message_id = m.id
        WHERE m.session_id = ?
        ORDER BY
          COALESCE(m.time_created, 0),
          m.id,
          COALESCE(p.time_created, 0),
          p.id
      `).all(providerSessionId) as OpenCodeHistoryRow[];

      // A Rewind leaves everything it reverted in OpenCode's own database, so a
      // straight read goes on rendering it. Filtered before anything else looks
      // at the rows, so anchors and pagination all count the same conversation.
      const activeRows = filterOpenCodeRevertedRows(
        rows,
        readOpenCodeRevertedMessageId(db, providerSessionId),
      );
      const normalized = this.normalizeHistoryRows(activeRows, sessionId);
      const tokenUsage = aggregateOpenCodeSessionTokenUsage(db, providerSessionId);

      const normalizedOffset = Math.max(0, offset);
      const normalizedLimit = limit === null ? null : Math.max(0, limit);
      const total = normalized.length;
      const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

      return {
        messages: page,
        total,
        hasMore,
        offset: normalizedOffset,
        limit: normalizedLimit,
        tokenUsage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[OpenCodeProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    } finally {
      db.close();
    }
  }

  private normalizeHistoryRows(rows: OpenCodeHistoryRow[], sessionId: string): NormalizedMessage[] {
    // Anchors are read off the raw rows rather than the normalized messages: an
    // anchor names an OpenCode message, and one message becomes several
    // messages here, each under an id of CloudCLI's own making.
    const anchors = buildOpenCodeAnchorIndex(rows);
    const rewindAnchors = buildOpenCodeRewindAnchorIndex(rows);
    const normalized: NormalizedMessage[] = [];
    const emittedMessageErrors = new Set<string>();

    for (const row of rows) {
      // Every message this row produces is forkable at the same anchor, and
      // rewindable at the other one — two rules, two rows, both opaque here.
      const anchor = anchors.get(row.message_id);
      const rewindAnchor = rewindAnchors.get(row.message_id);
      const push = (message: NormalizedMessage) => {
        if (anchor) {
          message.anchor = anchor;
        }
        if (rewindAnchor) {
          message.rewindAnchor = rewindAnchor;
        }
        normalized.push(message);
      };
      const timestamp = normalizeProviderTimestamp(row.part_time_created ?? row.message_time_created);
      const baseId = `${row.message_id}_${row.part_id ?? normalized.length}`;
      const messageInfo = readJsonRecord(row.message_data);
      const messageRole = readOptionalString(messageInfo?.role);

      if (
        messageInfo
        && messageRole === 'assistant'
        && messageInfo.error != null
        && !emittedMessageErrors.has(row.message_id)
      ) {
        emittedMessageErrors.add(row.message_id);
        push(createNormalizedMessage({
          id: `${baseId}_error`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'error',
          content: formatToolContent(messageInfo.error),
        }));
      }

      if (!row.part_id) {
        continue;
      }

      const partData = readJsonRecord(row.part_data) ?? {};
      const partType = readOptionalString(partData.type);
      if (!partType) {
        continue;
      }

      if (partType === 'text') {
        const rawContent = extractText(partData);
        // User prompts sent with attachments carry an <images_input> path
        // list; strip it for display and surface the paths as images.
        const parsedImages = messageRole === 'user'
          ? parseImagesInputTag(rawContent)
          : { text: rawContent, attachments: [] };
        const parsedFiles = messageRole === 'user'
          ? parseFilesInputTag(parsedImages.text)
          : { text: rawContent, attachments: [] };
        if (
          parsedFiles.text.trim()
          || parsedImages.attachments.length > 0
          || parsedFiles.attachments.length > 0
        ) {
          push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'text',
            role: messageRole === 'user' ? 'user' : 'assistant',
            content: parsedFiles.text,
            images: parsedImages.attachments.length > 0 ? parsedImages.attachments : undefined,
            files: parsedFiles.attachments.length > 0 ? parsedFiles.attachments : undefined,
          }));
        }
        continue;
      }

      if (partType === 'reasoning') {
        const content = extractText(partData);
        if (content.trim()) {
          push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'thinking',
            content,
          }));
        }
        continue;
      }

      if (partType === 'tool') {
        const state = readObjectRecord(partData.state) ?? {};
        const status = readOptionalString(state.status);
        const toolMessage = createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: readOptionalString(partData.tool) ?? 'Tool',
          toolInput: state.input ?? partData.input ?? {},
          toolId: readOptionalString(partData.callID) ?? row.part_id,
        });

        if (status === 'completed' || status === 'error') {
          toolMessage.toolResult = {
            content: formatToolContent(state.output ?? state.error),
            isError: status === 'error',
          };
        }

        push(toolMessage);
        continue;
      }

      if (partType === 'step-finish') {
        push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'stream_end',
        }));
        continue;
      }

      if (partType === 'patch' || partType === 'agent') {
        push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: partType === 'patch' ? 'Patch' : 'Agent',
          toolInput: partData,
          toolId: row.part_id,
        }));
      }

      /**
       * OpenCode persists a compaction as a `compaction` part on its own
       * synthetic user-role message with no accompanying text part (verified
       * against a real 1.18.18 session — see #21). Because this loop
       * dispatches per part rather than per message, that message never also
       * hits the `text` branch above, so no empty user bubble is emitted for
       * it — only this boundary marker.
       */
      if (partType === 'compaction') {
        push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'compact_boundary',
          // OpenCode's CompactionPart carries only `{type, auto}` — no token
          // counts — so compactPreTokens/compactPostTokens stay undefined and
          // the marker renders trigger-only, a shape #19 already supports.
          compactTrigger: partData.auto === true ? 'auto' : 'manual',
        }));
      }
    }

    return normalized;
  }

  /**
   * Copies the conversation up to `anchor`'s turn into a new session.
   *
   * Runs through the same short-lived headless server Compact uses, because
   * fork lives on OpenCode's HTTP API and nowhere else. The anchor already
   * accounts for that endpoint being **exclusive** — it names the message after
   * the turn to keep, which is one message further on than Claude's inclusive
   * fork lands (see `buildOpenCodeAnchorIndex`).
   */
  async forkSession(options: {
    providerSessionId: string;
    projectPath: string;
    anchor: string;
    title: string;
  }): Promise<string> {
    return forkOpenCodeSession(options.providerSessionId, {
      cwd: options.projectPath,
      anchor: options.anchor,
      title: options.title,
    });
  }
}
