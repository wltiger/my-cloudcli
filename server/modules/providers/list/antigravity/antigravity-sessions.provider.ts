/**
 * Antigravity (`agy`) session reader
 * ==================================
 *
 * History comes from one plain-text artifact per conversation:
 * `~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`.
 * The sibling `conversations/<id>.db` is never opened — it holds opaque
 * protobuf blobs behind a closed, fast-moving format — and
 * `conversation_summaries.db` (the list-view index, shared with the Antigravity
 * IDE) is only ever opened read-only, by the synchronizer.
 *
 * The record vocabulary is documented in
 * `docs/agents/antigravity-provider-implementation.md` §4 and was re-measured
 * against 41 real conversations (513 records) on `agy` 1.2.7.
 *
 * The optional fork / edit-anchor / rewind methods are deliberately absent:
 * ADR 0014 settles that `agy` cannot branch a conversation, and their absence
 * is what disables the corresponding UI. Nothing here emits `anchor` or
 * `transcriptAnchorId` for the same reason.
 */

import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { parseFilesInputTag, parseImagesInputTag } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
  unwrapJsonStringLiteral,
} from '@/shared/utils.js';

const PROVIDER = 'antigravity';

/** `agy` keeps its own state under `~/.gemini/antigravity-cli/`; the IDE uses the sibling `antigravity/`. */
export const getAntigravityAppDataDir = (): string => (
  path.join(os.homedir(), '.gemini', 'antigravity-cli')
);

/**
 * The conversation index, shared with the Antigravity IDE.
 *
 * Read-only, always: the IDE writes it while CloudCLI is running, and it is the
 * IDE's own sidebar state. Nothing in this fork may write, delete or take a
 * write lock on it, which is also why no session row ever records it as a
 * transcript path (see the synchronizer).
 */
export const getAntigravitySummariesDatabasePath = (): string => (
  path.join(getAntigravityAppDataDir(), 'conversation_summaries.db')
);

/** `app_data_dir` value that separates the CLI's conversations from the IDE's. */
export const ANTIGRAVITY_CLI_APP_DATA_DIR = 'antigravity-cli';

/**
 * Opens the shared conversation index read-only, or returns null when `agy`
 * has never run on this machine.
 */
export const openAntigravitySummariesDatabase = (): Database.Database | null => {
  const dbPath = getAntigravitySummariesDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    return null;
  }

  return new Database(dbPath, { readonly: true, fileMustExist: true });
};

/**
 * Resolves one conversation's log directory.
 *
 * The id is a key from a database shared with another application, so it is
 * checked to be a single path segment before being joined: a conversation id
 * that is not one is not a conversation this provider knows how to read.
 */
const resolveConversationLogDir = (conversationId: string): string | null => {
  const trimmed = conversationId.trim();
  if (!trimmed || trimmed !== path.basename(trimmed) || trimmed.includes('..')) {
    return null;
  }

  return path.join(getAntigravityAppDataDir(), 'brain', trimmed, '.system_generated', 'logs');
};

/** The transcript file for one conversation, whether or not it exists yet. */
export const getAntigravityTranscriptPath = (conversationId: string): string | null => {
  const logDir = resolveConversationLogDir(conversationId);
  return logDir ? path.join(logDir, 'transcript.jsonl') : null;
};

/**
 * The conversation id a transcript path belongs to, or null when the path is
 * not one of `agy`'s transcripts.
 */
export const readConversationIdFromTranscriptPath = (filePath: string): string | null => {
  if (path.basename(filePath) !== 'transcript.jsonl') {
    return null;
  }

  // …/brain/<conversation-id>/.system_generated/logs/transcript.jsonl
  const conversationId = path.basename(path.resolve(filePath, '..', '..', '..'));
  const expected = getAntigravityTranscriptPath(conversationId);
  return expected && path.resolve(expected) === path.resolve(filePath) ? conversationId : null;
};

/** Fields `truncated_fields` may name that this reader restores from the untruncated transcript. */
const RESTORABLE_TRUNCATED_FIELDS = new Set(['content', 'thinking']);

/** The record types observed on `agy` 1.2.7; treated as a floor, never as a closed set. */
const USER_INPUT_TYPE = 'USER_INPUT';
const TOOL_RESULT_TYPE = 'GENERIC';
const TOOL_RESULT_SOURCE = 'MODEL';
const USER_INPUT_SOURCE = 'USER_EXPLICIT';

/** `<USER_REQUEST>` is the only part of a user record that the user actually typed. */
const USER_REQUEST_PATTERN = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/;
/** Blocks `agy` appends after the prompt; none of them are the user's words. */
const USER_METADATA_PATTERN = /<(?:ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>[\s\S]*/;

const readStepIndex = (record: AnyRecord, fallback: number): number => {
  const parsed = Number(record.step_index);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readTruncatedFields = (record: AnyRecord): string[] => (
  Array.isArray(record.truncated_fields)
    ? record.truncated_fields.filter((field): field is string => typeof field === 'string')
    : []
);

const readToolCalls = (record: AnyRecord): AnyRecord[] => (
  Array.isArray(record.tool_calls)
    ? record.tool_calls.map((call) => readObjectRecord(call)).filter((call): call is AnyRecord => call !== null)
    : []
);

/** Parses one JSONL file into records, skipping lines that are not JSON objects. */
const readTranscriptRecords = (filePath: string): AnyRecord[] => {
  let raw: string;
  try {
    raw = fsSync.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const records: AnyRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const record = readObjectRecord(JSON.parse(line));
      if (record) {
        records.push(record);
      }
    } catch {
      // A partially flushed last line is normal while a turn is in flight.
    }
  }

  return records;
};

/**
 * Restores the fields `transcript.jsonl` elided, from `transcript_full.jsonl`.
 *
 * Only the fields a record itself names in `truncated_fields`, and only the two
 * this reader renders — a name the writer invented would otherwise be copied
 * onto the record under a key nothing here controls.
 */
const restoreTruncatedFields = (logDir: string, records: AnyRecord[]): AnyRecord[] => {
  if (!records.some((record) => readTruncatedFields(record).length > 0)) {
    return records;
  }

  const fullRecords = readTranscriptRecords(path.join(logDir, 'transcript_full.jsonl'));
  if (fullRecords.length === 0) {
    return records;
  }

  const byStepIndex = new Map<number, AnyRecord>(
    fullRecords.map((record, index) => [readStepIndex(record, index), record]),
  );

  return records.map((record, index) => {
    const truncated = readTruncatedFields(record).filter((field) => RESTORABLE_TRUNCATED_FIELDS.has(field));
    if (truncated.length === 0) {
      return record;
    }

    const full = byStepIndex.get(readStepIndex(record, index));
    if (!full) {
      return record;
    }

    const restored = { ...record };
    for (const field of truncated) {
      if (typeof full[field] === 'string') {
        restored[field] = full[field];
      }
    }
    return restored;
  });
};

/**
 * Every record of one conversation, in step order and with elided text restored.
 *
 * Sorting is not cosmetic: `agy` appends parallel tool results as they land, so
 * a turn that called five tools at once writes steps 12-15 *before* step 11.
 * Everything downstream — tool/result pairing, pagination, the rendered order —
 * reads step order, which is also what survives `agy` rewriting the file
 * underneath us during its own compaction.
 */
export const readAntigravityConversationRecords = (conversationId: string): AnyRecord[] => {
  const logDir = resolveConversationLogDir(conversationId);
  if (!logDir) {
    return [];
  }

  const records = readTranscriptRecords(path.join(logDir, 'transcript.jsonl'));
  if (records.length === 0) {
    return records;
  }

  return restoreTruncatedFields(logDir, records)
    .map((record, index) => ({ record, stepIndex: readStepIndex(record, index), index }))
    .sort((left, right) => left.stepIndex - right.stepIndex || left.index - right.index)
    .map((entry) => entry.record);
};

/** Strips the envelope and the metadata blocks `agy` wraps a user prompt in. */
const unwrapUserRequest = (content: string): string => {
  const match = USER_REQUEST_PATTERN.exec(content);
  if (match) {
    return match[1].trim();
  }

  return content.replace(USER_METADATA_PATTERN, '').trim();
};

/** True for a record that can be the result of a preceding tool call. */
const isToolResultRecord = (record: AnyRecord): boolean => (
  readOptionalString(record.type) === TOOL_RESULT_TYPE
  && readOptionalString(record.source) === TOOL_RESULT_SOURCE
  && readToolCalls(record).length === 0
);

const isUserRecord = (record: AnyRecord): boolean => (
  readOptionalString(record.type) === USER_INPUT_TYPE
  || readOptionalString(record.source) === USER_INPUT_SOURCE
);

/** A record reports failure through `status: "ERROR"`, an `error` string, or both. */
const readRecordError = (record: AnyRecord): string | null => {
  const error = readOptionalString(record.error);
  if (error) {
    return error;
  }

  return readOptionalString(record.status) === 'ERROR'
    ? readOptionalString(record.content) ?? 'Antigravity reported an error for this step.'
    : null;
};

/**
 * Reads one tool call's arguments.
 *
 * `agy` persists every argument as its own JSON literal, so a command arrives
 * as `"\"npm run build\""`. Decoding it is what keeps the tool card from
 * showing every path and command wrapped in stray quotes.
 */
const readToolInput = (call: AnyRecord): AnyRecord => {
  const args = readObjectRecord(call.args);
  if (!args) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      typeof value === 'string' ? unwrapJsonStringLiteral(value) : value,
    ]),
  );
};

/**
 * Turns one tool-result record into the payload that rides on its tool card.
 */
const buildToolResult = (record: AnyRecord): { content: string; isError: boolean } => {
  const error = readRecordError(record);
  return {
    content: error ?? readOptionalString(record.content) ?? '',
    isError: error !== null,
  };
};

/**
 * Normalizes one transcript record, with the results of its own tool calls when
 * the caller has them.
 *
 * The dispatch is deliberately field-driven rather than a switch over the four
 * observed `type` values: that vocabulary is internal Cascade naming that
 * appears in no published proto (build guide §4, open question Q1), so a type
 * this fork has never seen still renders everything it carries — thinking,
 * prose, tool calls, errors — instead of vanishing from the transcript.
 */
const normalizeAntigravityRecord = (
  record: AnyRecord,
  sessionId: string,
  fallbackIndex: number,
  toolResults: AnyRecord[] = [],
): NormalizedMessage[] => {
  const stepIndex = readStepIndex(record, fallbackIndex);
  const timestamp = normalizeProviderTimestamp(record.created_at);
  // Stable across reloads: the same conversation always yields the same ids, so
  // a re-read after `agy` rewrote the file updates rows instead of doubling them.
  const baseId = `antigravity-${sessionId || 'session'}-${stepIndex}`;
  const messages: NormalizedMessage[] = [];

  if (isUserRecord(record)) {
    const prompt = unwrapUserRequest(readOptionalString(record.content) ?? '');
    // Attachments ride into the prompt as `<images_input>`/`<files_input>` path
    // lists (the runtime has no attachment block to use), so they come back out
    // here rather than rendering as raw tags.
    const parsedImages = parseImagesInputTag(prompt);
    const parsedFiles = parseFilesInputTag(parsedImages.text);
    if (parsedFiles.text.trim() || parsedImages.attachments.length > 0 || parsedFiles.attachments.length > 0) {
      messages.push(createNormalizedMessage({
        id: `${baseId}-user`,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'text',
        role: 'user',
        content: parsedFiles.text,
        images: parsedImages.attachments.length > 0 ? parsedImages.attachments : undefined,
        files: parsedFiles.attachments.length > 0 ? parsedFiles.attachments : undefined,
      }));
    }

    return messages;
  }

  const thinking = readOptionalString(record.thinking);
  if (thinking?.trim()) {
    messages.push(createNormalizedMessage({
      id: `${baseId}-thinking`,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'thinking',
      content: thinking,
    }));
  }

  const toolCalls = readToolCalls(record);
  const error = readRecordError(record);
  const content = readOptionalString(record.content);

  // An unpaired failure is its own bubble. A failure that belongs to a tool call
  // is not: it is already on that call's card, so reporting it twice would read
  // as two separate failures.
  if (error && toolCalls.length === 0) {
    messages.push(createNormalizedMessage({
      id: `${baseId}-error`,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'error',
      content: error,
    }));
  } else if (content?.trim()) {
    // Assistant prose, and also the system notices `agy` injects into its own
    // conversation (`SYSTEM_MESSAGE`) — the message shape has no system role, and
    // dropping them would hide the reason a turn behaved the way it did.
    messages.push(createNormalizedMessage({
      id: `${baseId}-text`,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'text',
      role: 'assistant',
      content,
    }));
  }

  toolCalls.forEach((call, callIndex) => {
    const toolMessage = createNormalizedMessage({
      id: `${baseId}-tool-${callIndex}`,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'tool_use',
      toolName: readOptionalString(call.name) ?? 'Tool',
      toolInput: readToolInput(call),
      toolId: `${baseId}-tool-${callIndex}`,
    });

    const result = toolResults[callIndex];
    if (result) {
      toolMessage.toolResult = buildToolResult(result);
    }

    messages.push(toolMessage);
  });

  return messages;
};

/**
 * Normalizes a whole conversation, pairing each tool call with its result.
 *
 * `agy` writes a tool call and its result as separate records: a record with
 * `tool_calls[]` is followed, in step order, by one result record per call. So
 * the N records after an N-call step are consumed into that step's cards rather
 * than rendered as N anonymous blobs of tool output. A call whose result never
 * arrived (the conversation ended mid-tool) simply keeps a card with no result.
 */
const normalizeAntigravityRecords = (records: AnyRecord[], sessionId: string): NormalizedMessage[] => {
  const consumed = new Set<number>();
  const messages: NormalizedMessage[] = [];

  for (let index = 0; index < records.length; index += 1) {
    if (consumed.has(index)) {
      continue;
    }

    const record = records[index];
    const toolResults: AnyRecord[] = [];
    const expectedResults = readToolCalls(record).length;
    for (let next = index + 1; next < records.length && toolResults.length < expectedResults; next += 1) {
      if (!isToolResultRecord(records[next])) {
        break;
      }

      toolResults.push(records[next]);
      consumed.add(next);
    }

    messages.push(...normalizeAntigravityRecord(record, sessionId, index, toolResults));
  }

  return messages;
};

export class AntigravitySessionsProvider implements IProviderSessions {
  /**
   * Normalizes one `transcript.jsonl` record into frontend messages.
   *
   * Live turns do not come through here — the runtime maps `agy`'s NDJSON
   * stream itself — so a single record is all this ever sees, and a tool call
   * normalized on its own carries no result: the result is a separate record
   * that only `fetchHistory` has in hand.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const record = readObjectRecord(rawMessage);
    if (!record) {
      return [];
    }

    return normalizeAntigravityRecord(record, sessionId ?? '', 0);
  }

  /**
   * Loads one conversation's history from its transcript file.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    // `agy` names its transcript directory after the conversation id it resumes
    // with (`--conversation <uuid>`), which app-created sessions do not use as
    // their own id.
    const providerSessionId = options.providerSessionId ?? sessionId;

    try {
      const records = readAntigravityConversationRecords(providerSessionId);
      const normalized = normalizeAntigravityRecords(records, sessionId);

      const normalizedOffset = Math.max(0, offset);
      // `limit: 0` is an empty page and `limit: null` is unbounded — they are
      // not the same request.
      const normalizedLimit = limit === null ? null : Math.max(0, limit);
      const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

      return {
        messages: page,
        total: normalized.length,
        hasMore,
        offset: normalizedOffset,
        limit: normalizedLimit,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[AntigravityProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  }
}
