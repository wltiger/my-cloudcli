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
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage, SubagentActivity } from '@/shared/types.js';
import {
  createNormalizedMessage,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
} from '@/shared/utils.js';
import {
  AGY_ARTIFACT_DOC_TOOL,
  mapAntigravityTool,
  parseAgyQuestionAnswers,
  readAgySubagentConversationIds,
  readAgySubagentSpecs,
  readAgyTaskName,
} from '@/modules/providers/list/antigravity/antigravity-tool-mapping.js';
import { cleanAntigravityToolOutput } from '@/modules/providers/list/antigravity/antigravity-tool-output.js';

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
const getAntigravitySummariesDatabasePath = (): string => (
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
const getAntigravityTranscriptPath = (conversationId: string): string | null => {
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
const RESTORABLE_TRUNCATED_FIELDS = new Set(['content', 'thinking', 'tool_calls']);

/** The record types observed on `agy` 1.2.7; treated as a floor, never as a closed set. */
const USER_INPUT_TYPE = 'USER_INPUT';
const TOOL_RESULT_TYPE = 'GENERIC';
const TOOL_RESULT_SOURCE = 'MODEL';
const USER_INPUT_SOURCE = 'USER_EXPLICIT';
const SYSTEM_MESSAGE_TYPE = 'SYSTEM_MESSAGE';
/** Only ever observed at a context compaction (build guide §4). */
const CHECKPOINT_TYPE = 'CHECKPOINT';

const SYSTEM_MESSAGE_OPEN_TAG = '<SYSTEM_MESSAGE>';
const SYSTEM_MESSAGE_CLOSE_TAG = '</SYSTEM_MESSAGE>';
const SYSTEM_MESSAGE_HEADER = '[Message]';
const SYSTEM_MESSAGE_BODY_ATTRIBUTE = 'content=';
const SYSTEM_MESSAGE_SENDER_PATTERN = /(?:^|\s)sender=(\S+)/;
/** A sender shaped like this is another conversation — a sub-agent reporting back. */
const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Length of the one-line preview a system notice renders collapsed. */
const NOTICE_SUMMARY_MAX_LENGTH = 200;
/** A background task that finished: the code decides the card's dot. */
const TASK_EXIT_CODE_PATTERN = /\bexited with code (\d+)/;
/** A task stopped before it finished — not a success, and not a failed exit code. */
const TASK_CANCELLED_PATTERN = /\bwas canceled\b/i;
/** `…/task-72` senders name the task the notice is about. */
const TASK_SENDER_PATTERN = /task-\d+$/;

/**
 * The outcomes a background notice can report, plus `info` for one that
 * reports none.
 *
 * Only one carries an exit code. A cancelled task and a timer expiry report
 * neither, and a notice that has no code must never be shown as though it had
 * one — `task-343 · exit code undefined` is worse than no preview at all.
 */
type AgyNoticeOutcome = {
  status: 'completed' | 'failed' | 'cancelled' | 'info';
  /** The collapsed one-line preview, or null when the body itself should show. */
  preview: string | null;
};

const readNoticeOutcome = (body: string, taskName: string | null): AgyNoticeOutcome => {
  const exitCodeMatch = TASK_EXIT_CODE_PATTERN.exec(body);
  if (exitCodeMatch) {
    const exitCode = Number(exitCodeMatch[1]);
    return {
      status: exitCode === 0 ? 'completed' : 'failed',
      preview: taskName ? `${taskName} · exit code ${exitCode}` : `exit code ${exitCode}`,
    };
  }

  if (TASK_CANCELLED_PATTERN.test(body)) {
    return {
      status: 'cancelled',
      preview: taskName ? `${taskName} · cancelled` : 'cancelled',
    };
  }

  // A timer expiry or a plain notice: the body is the message, so no preview is
  // derived from it — the renderer falls back to a flattened line. Nor does it
  // report a success: `completed` paints the green dot, and a server restart
  // stopping every task is not one. `info` has no dot of its own, so the row
  // keeps the amber it uses for anything that is not an outcome.
  return { status: 'info', preview: null };
};

/**
 * The id every message of one step carries, on the history and the live path
 * alike. Shared with the live fold in `antigravity-runtime.provider.ts`.
 *
 * Built from the app session id, never the `agy` conversation id: the frontend
 * prunes a live row against its persisted twin by exact id (or `toolId`), so
 * both paths have to agree on the one id they both know. Without an app
 * session id — a run no caller named — the fixed literal makes the row
 * never-pruned rather than wrongly pruned.
 */
export const buildAntigravityMessageId = (
  appSessionId: string | null,
  stepIndex: number | string,
  suffix: 'system' | 'tool' | 'compact',
): string => `antigravity-${appSessionId || 'session'}-${stepIndex}-${suffix}`;

/**
 * The compact-boundary divider a `CHECKPOINT` renders, built identically on
 * the history and the live path so the two rows prune against each other.
 * Shared with the live fold in `antigravity-runtime.provider.ts`.
 *
 * The history path passes the record's own timestamp; the live path omits it
 * and `createNormalizedMessage` stamps the divider with the current time.
 */
export const buildAntigravityCompactBoundary = (
  appSessionId: string | null,
  stepIndex: number | string,
  sessionId: string | null,
  timestamp?: string,
): NormalizedMessage => createNormalizedMessage({
  id: buildAntigravityMessageId(appSessionId, stepIndex, 'compact'),
  sessionId: sessionId || '',
  ...(timestamp ? { timestamp } : {}),
  provider: PROVIDER,
  kind: 'compact_boundary',
  // `agy` has no manual compaction.
  compactTrigger: 'auto',
});

/**
 * Splits a `SYSTEM_MESSAGE` into who sent it and what it says, or null when it
 * is not the envelope this reader knows.
 *
 * The content opens with boilerplate that itself names `<SYSTEM_MESSAGE>`
 * inline, so the real opening tag is the last one before the closing tag. The
 * `[Message]` header's attributes are read in no fixed order; `content=` is
 * unquoted and unterminated, so it is necessarily last, and the body runs from
 * the first `content=` to the closing tag — the body may say `content=` itself.
 * A missing closing tag (a live buffer cut short) lets the body run to the end.
 *
 * An envelope with no `[Message]` header — the form a Stop-hook notice takes —
 * is all body and no sender: the text between the real tags. That form needs
 * its closing tag, because nothing else marks where the body ends.
 */
const parseSystemMessageEnvelope = (content: string): { sender: string | null; body: string } | null => {
  const closeIndex = content.lastIndexOf(SYSTEM_MESSAGE_CLOSE_TAG);
  const end = closeIndex === -1 ? content.length : closeIndex;
  const openIndex = content.lastIndexOf(SYSTEM_MESSAGE_OPEN_TAG, end - SYSTEM_MESSAGE_OPEN_TAG.length);
  if (openIndex === -1) {
    return null;
  }

  const inner = content.slice(openIndex + SYSTEM_MESSAGE_OPEN_TAG.length, end).trimStart();
  const bodyIndex = inner.indexOf(SYSTEM_MESSAGE_BODY_ATTRIBUTE);
  if (!inner.startsWith(SYSTEM_MESSAGE_HEADER) || bodyIndex === -1) {
    return closeIndex === -1 ? null : { sender: null, body: inner.trim() };
  }

  const attributes = inner.slice(SYSTEM_MESSAGE_HEADER.length, bodyIndex);
  return {
    sender: SYSTEM_MESSAGE_SENDER_PATTERN.exec(attributes)?.[1] ?? null,
    body: inner.slice(bodyIndex + SYSTEM_MESSAGE_BODY_ATTRIBUTE.length).trim(),
  };
};

/**
 * Normalizes one `SYSTEM_MESSAGE` into what it actually is.
 *
 * A sub-agent's findings (the sender is a conversation id) render as a full
 * assistant message with the envelope stripped. Everything else — `system`,
 * task and timer senders, and any envelope this reader does not recognise —
 * is a compact notice: the envelope wording is `agy`'s internal naming, not a
 * contract, so a mismatch degrades to the raw text rather than losing it.
 *
 * A finished background task carries its exit code in the body and the code is
 * the card's state: a command that ended 1 must not paint the same dot as one
 * that ended 0. Cancelled and code-less notices get their own outcomes rather
 * than being forced into that shape. The body is kept whole — the one line is
 * a preview, and the output is what the notice exists to show.
 * Shared with the live fold so a reload renders the same row.
 */
export const normalizeAntigravitySystemMessage = ({
  content,
  id,
  sessionId,
  timestamp,
}: {
  content: string;
  id: string;
  sessionId: string | null;
  timestamp?: string;
}): NormalizedMessage | null => {
  const envelope = parseSystemMessageEnvelope(content);
  const body = envelope ? envelope.body : content.trim();
  if (!body) {
    return null;
  }

  if (envelope?.sender && CONVERSATION_ID_PATTERN.test(envelope.sender)) {
    return createNormalizedMessage({
      id,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'text',
      role: 'assistant',
      content: body,
    });
  }

  const sender = envelope?.sender ?? '';
  const taskName = TASK_SENDER_PATTERN.test(sender) ? readAgyTaskName(sender) : null;
  const outcome = readNoticeOutcome(body, taskName);
  // No preview means the body is the message (a timer, a plain notice): show a
  // flattened line rather than inventing an outcome it does not report.
  const flattened = body.replace(/\s+/g, ' ').trim();
  const summarySource = outcome.preview ?? flattened;
  const summary = summarySource.length > NOTICE_SUMMARY_MAX_LENGTH
    ? `${summarySource.slice(0, NOTICE_SUMMARY_MAX_LENGTH - 1)}…`
    : summarySource;

  return createNormalizedMessage({
    id,
    sessionId,
    timestamp,
    provider: PROVIDER,
    kind: 'task_notification',
    status: outcome.status,
    summary,
    content: body,
    ...(taskName ? { taskName } : {}),
  });
};

/**
 * Whether a raw stream line is a system-message envelope printed as plain
 * text — the pre-1.2.13 stream behavior the live fold still has to absorb.
 * Both markers are required so an output line that merely quotes the tag is
 * not mistaken for one.
 */
export const isAntigravitySystemMessageLine = (line: string): boolean => (
  line.includes(SYSTEM_MESSAGE_OPEN_TAG) && line.includes(SYSTEM_MESSAGE_HEADER)
);

/** `<USER_REQUEST>` is the only part of a user record that the user actually typed. */
const USER_REQUEST_PATTERN = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/;
/** Blocks `agy` appends after the prompt; none of them are the user's words. */
const USER_METADATA_PATTERN = /<(?:ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>[\s\S]*/;

const readStepIndex = (record: AnyRecord, fallback: number): number => {
  const parsed = Number(record.step_index);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * A record's timestamp, or a deterministic stand-in.
 *
 * The shared helper falls back to wall-clock time, so the same persisted row
 * reads back with two different timestamps. Harmless while ids match, but it is
 * the last link in the chain that duplicates rows: a tool card's id drifts when
 * out-of-order results shift its pairing, the drift sends row matching to its
 * comparison fallback, and a changing timestamp then guarantees the two never
 * compare equal. A missing timestamp therefore falls back to the previous
 * record's, and to empty when there is none — never to the clock.
 */
const readRecordTimestamp = (record: AnyRecord, previous: string | null): string | undefined => {
  const value = record.created_at;
  if ((typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value) && value > 0)) {
    return normalizeProviderTimestamp(value);
  }

  return previous ?? '';
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
 * Only the fields a record itself names in `truncated_fields`, and only the ones
 * this reader renders — a name the writer invented would otherwise be copied
 * onto the record under a key nothing here controls. `tool_calls` is an array:
 * its elided form keeps the shape but cuts an argument's JSON literal short,
 * which is what leaves a tool card unreadable. Best effort: with no full record
 * at that step the elided one renders as it is.
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
      if (typeof full[field] === 'string' || Array.isArray(full[field])) {
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
const readAntigravityConversationRecords = (conversationId: string): AnyRecord[] => {
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
 * Reads one tool call's arguments, as stored.
 *
 * Decoding is the mapping module's job, not this reader's: it decodes
 * selectively, because a content argument that happens to be valid JSON must
 * stay a string. Handing it the stored values is what keeps that decision in
 * one place for both provider paths.
 */
const readToolInput = (call: AnyRecord): AnyRecord => readObjectRecord(call.args) ?? {};

/**
 * Turns one tool-result record into the payload that rides on its tool card.
 *
 * The scaffolding `agy` wraps results in (timestamps, view-file notes, the
 * background instruction block) is stripped here so the card shows the output.
 */
const buildToolResult = (record: AnyRecord): { content: string; isError: boolean } => {
  const error = readRecordError(record);
  return {
    content: cleanAntigravityToolOutput(error ?? readOptionalString(record.content) ?? ''),
    isError: error !== null,
  };
};

/**
 * What a whole-conversation pass knows that one record alone cannot: the
 * subagents spawned here and what each reported back, the timestamp of the
 * record before this one, and the conversation id media urls are built from.
 */
type AntigravityRecordContext = {
  /** Conversation ids spawned in this conversation, so their reports fold in. */
  spawnedIds: Set<string>;
  /** What each spawned agent reported; the latest report wins. */
  reports: Map<string, string>;
  /** The previous record's timestamp, so a missing one never becomes the clock. */
  previousTimestamp: string | null;
  /** The conversation media urls are addressed by. Empty for a single record. */
  conversationId: string;
};

/** How much of one agent's run the panel ships; longer runs say so via `activityCount`. */
const SUBAGENT_ACTIVITY_CAP = 100;

/** Where `agy` stores the images its tools produce, inside a conversation's directory. */
const ANTIGRAVITY_MEDIA_DIR = '.tempmediaStorage';

/**
 * The image types the media route serves, by extension. SVG is excluded:
 * serving another application's SVG inline is an XSS surface.
 */
const ANTIGRAVITY_MEDIA_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

type AntigravityMediaItem = { url: string; name: string; mimeType: string };

/** Everything one conversation keeps: its logs, its media, the files its model saved. */
const getAntigravityConversationDir = (conversationId: string): string => (
  path.join(getAntigravityAppDataDir(), 'brain', conversationId)
);

/**
 * A local path from the way `agy` wrote it: a bare path with either separator,
 * or a `file:` URL. A Windows file URL keeps a slash in front of its drive
 * letter (`file:///C:/…` → `/C:/…`), which resolves onto the current drive
 * rather than that one, so it is dropped. Null for an escape that does not
 * decode.
 */
const readLocalPath = (value: string): string | null => {
  if (!/^file:/i.test(value)) {
    return value;
  }

  try {
    return decodeURIComponent(value.replace(/^file:\/\/(?:localhost)?/i, '')).replace(/^\/([A-Za-z]:)/, '$1');
  } catch {
    return null;
  }
};

/**
 * Where an image sits inside one conversation's directory, as path segments,
 * or null when the path leads anywhere else or is not an image the media route
 * serves. This is what keeps a path in the transcript from becoming a read of
 * an arbitrary file: only the conversation's own directory is addressable.
 *
 * Separators are unified first, so a path written with backslashes resolves the
 * same on every platform; on Windows the comparison ignores case, as the
 * filesystem does.
 */
const readConversationImagePath = (conversationId: string, localPath: string): string[] | null => {
  const relative = path.relative(
    getAntigravityConversationDir(conversationId),
    path.resolve(localPath.replace(/\\/g, '/')),
  );
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return ANTIGRAVITY_MEDIA_MIME_TYPES[path.extname(relative).toLowerCase()] ? relative.split(path.sep) : null;
};

/**
 * The media route's url for one image in a conversation's directory.
 *
 * A `.tempmediaStorage` image is addressed by its name alone — the form every
 * tool-result url has always had, and the one the route resolves into that
 * directory first — so no url a thumbnail already uses changes, and none
 * carries a dot-segment a proxy might refuse. Any other image is addressed by
 * its path from the conversation's directory. Parentheses are escaped so the
 * url can stand in a markdown image unbalanced.
 */
const buildAntigravityMediaUrl = (conversationId: string, segments: string[]): string => {
  const addressed = segments.length === 2 && segments[0] === ANTIGRAVITY_MEDIA_DIR ? segments.slice(1) : segments;
  const encode = (segment: string): string => encodeURIComponent(segment)
    .replace(/[()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `/api/providers/antigravity/media/${encode(conversationId)}/${addressed.map(encode).join('/')}`;
};

/**
 * The image files a tool result recorded, as identifiers the frontend can fetch.
 *
 * `agy` stores tool-result images under the conversation's `.tempmediaStorage`
 * directory and names them by absolute path — or `file:` URL — in the record.
 * Only an image inside the conversation's own directory is offered: a
 * thumbnail that would 404 on click is worse than no thumbnail. The route
 * re-validates on delivery.
 */
const readAntigravityMedia = (
  conversationId: string,
  record: AnyRecord | null,
): AntigravityMediaItem[] | null => {
  if (!record || !Array.isArray(record.media) || !conversationId) {
    return null;
  }

  const media: AntigravityMediaItem[] = [];
  for (const entry of record.media) {
    const item = readObjectRecord(entry);
    const mimeType = readOptionalString(item?.mime_type);
    if (!mimeType || !mimeType.startsWith('image/')) {
      continue;
    }

    const localPath = readLocalPath(readOptionalString(item?.uri) ?? '');
    const segments = localPath ? readConversationImagePath(conversationId, localPath) : null;
    if (!segments) {
      continue;
    }

    media.push({
      url: buildAntigravityMediaUrl(conversationId, segments),
      name: segments[segments.length - 1],
      mimeType,
    });
  }
  return media.length > 0 ? media : null;
};

/**
 * A markdown image: `![alt](` and the destination, in angle brackets or bare —
 * a bare one may hold balanced parentheses, as in `shot(1).png`. The lookahead
 * requires the closing parenthesis without consuming it, so a title after the
 * destination is left exactly as written.
 */
const MARKDOWN_IMAGE_PATTERN = /(!\[[^\]\n]*\]\(\s*)(<[^>\n]*>|(?:[^\s()]|\([^\s()]*\))+)(?=[^)\n]*\))/g;

/** An absolute path, either separator, or a `file:` URL — never a relative one. */
const ABSOLUTE_LOCAL_PATH_PATTERN = /^(?:file:|[A-Za-z]:[\\/]|[\\/])/i;

/**
 * Points markdown images at this conversation's own files through the media
 * route.
 *
 * `agy` writes a screenshot into its prose by absolute local path (`C:/…`,
 * `C:\…` or `file:///C:/…`). A browser can open none of them, and the markdown
 * renderer blanks every one, since its url filter keeps only web schemes and
 * relative urls. An image inside the conversation's directory becomes a media
 * route url, which the renderer keeps and fetches with the auth header. Every
 * other path is left as written: a relative one names a file relative to a
 * document this reader cannot see, and one outside the conversation must not
 * become a way to read it.
 */
export const rewriteAntigravityImageLinks = (text: string, conversationId: string): string => {
  if (!conversationId || !text.includes('![')) {
    return text;
  }

  return text.replace(MARKDOWN_IMAGE_PATTERN, (match, head: string, destination: string) => {
    const unwrapped = destination.startsWith('<') ? destination.slice(1, -1) : destination;
    if (!ABSOLUTE_LOCAL_PATH_PATTERN.test(unwrapped)) {
      return match;
    }

    const localPath = readLocalPath(unwrapped);
    const segments = localPath ? readConversationImagePath(conversationId, localPath) : null;
    return segments ? `${head}${buildAntigravityMediaUrl(conversationId, segments)}` : match;
  });
};

/**
 * The timeline the SubagentPanel draws for one spawned agent, read from the
 * agent's own transcript.
 *
 * The subagent's transcript uses the same record vocabulary as the parent's, so
 * it is read through the same functions and its tool calls through the same
 * mapping — a subagent's shell command renders exactly as one the top-level
 * agent ran. The step-0 record is the task prompt itself, which the panel shows
 * from the call's input, so it is skipped rather than doubled.
 *
 * Returns null when the agent's transcript is not readable: the container still
 * renders, with the report as its result, and no timeline.
 */
const readAntigravitySubagentTimeline = (
  subConversationId: string,
): { activity: SubagentActivity[]; count: number } | null => {
  const records = readAntigravityConversationRecords(subConversationId);
  if (records.length === 0) {
    return null;
  }

  const activity: SubagentActivity[] = [];
  let total = 0;
  const push = (entry: SubagentActivity): void => {
    total += 1;
    if (activity.length < SUBAGENT_ACTIVITY_CAP) {
      activity.push(entry);
    }
  };

  let index = 0;
  while (index < records.length) {
    const record = records[index];
    const timestamp = readRecordTimestamp(record, null);
    const calls = readToolCalls(record);

    if (calls.length > 0) {
      // Results pair positionally, as in the parent transcript: the N records
      // right after an N-call record are that record's outputs.
      let consumed = 0;
      while (consumed < calls.length && isToolResultRecord(records[index + 1 + consumed])) {
        consumed += 1;
      }

      calls.forEach((call, callIndex) => {
        const paired = callIndex < consumed ? records[index + 1 + callIndex] : null;
        const resultInfo = paired ? buildToolResult(paired) : null;
        const mapped = mapAntigravityTool(
          readOptionalString(call.name) ?? 'Tool',
          readToolInput(call),
          resultInfo?.content ?? null,
        );
        push({
          kind: 'tool',
          timestamp,
          toolName: mapped.toolName,
          toolInput: mapped.input,
          toolResult: resultInfo,
        });
      });
      index += 1 + consumed;
      continue;
    }

    if (isUserRecord(record)) {
      index += 1;
      continue;
    }

    const thinking = readOptionalString(record.thinking);
    if (thinking?.trim()) {
      push({ kind: 'thinking', timestamp, content: thinking });
    }
    const content = readOptionalString(record.content);
    if (content?.trim()) {
      push({ kind: 'text', timestamp, content: cleanAntigravityToolOutput(content) });
    }
    index += 1;
  }

  return activity.length > 0 ? { activity, count: total } : null;
};

/**
 * Pre-scans a conversation for subagent spawns and their reports.
 *
 * A spawn is an `invoke_subagent` call whose result names the new conversation
 * ids — the only source present for every spawn. A report is a `SYSTEM_MESSAGE`
 * whose sender is one of those ids. The `CHECKPOINT` record's `# Subagents`
 * block also lists them, but it exists only after a compaction and only names
 * the agents alive at that moment, so it is not the primary source.
 *
 * Positional in the same way the tool pairing is, so a shape drift degrades to
 * a report rendering as an assistant message — the previous behavior — rather
 * than to losing it.
 */
const collectAntigravitySubagentContext = (records: AnyRecord[]): {
  spawnedIds: Set<string>;
  reports: Map<string, string>;
} => {
  const spawnedIds = new Set<string>();
  const reports = new Map<string, string>();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const hasSpawn = readToolCalls(record).some(
      (call) => readOptionalString(call.name) === 'invoke_subagent',
    );
    if (hasSpawn) {
      const next = records[index + 1];
      if (next && isToolResultRecord(next)) {
        for (const id of readAgySubagentConversationIds(readOptionalString(next.content) ?? null)) {
          spawnedIds.add(id);
        }
      }
    }

    if (readOptionalString(record.type) === SYSTEM_MESSAGE_TYPE) {
      const envelope = parseSystemMessageEnvelope(readOptionalString(record.content) ?? '');
      if (envelope?.sender && CONVERSATION_ID_PATTERN.test(envelope.sender)) {
        reports.set(envelope.sender, envelope.body);
      }
    }
  }

  return { spawnedIds, reports };
};

/**
 * Normalizes one transcript record, with the results of its own tool calls when
 * the caller has them.
 *
 * The dispatch is deliberately field-driven rather than a switch over the
 * observed `type` values: that vocabulary is internal Cascade naming that
 * appears in no published proto (build guide §4, open question Q1), so a type
 * this fork has never seen still renders everything it carries — thinking,
 * prose, tool calls, errors — instead of vanishing from the transcript. Only
 * `SYSTEM_MESSAGE` and `CHECKPOINT` are routed by type, because what they carry
 * is `agy`'s own scaffolding rather than anything the agent said.
 */
/** One step's record, when it is the kind the live path is waiting for. */
const readRecordAtStep = (
  conversationId: string | null,
  stepIndex: string,
  matches: (record: AnyRecord) => boolean,
): AnyRecord | null => {
  if (!conversationId) {
    return null;
  }

  return readAntigravityConversationRecords(conversationId).find((record) => (
    matches(record) && String(readStepIndex(record, -1)) === String(stepIndex)
  )) ?? null;
};

/**
 * The raw content of one step's `SYSTEM_MESSAGE` record, for the live path.
 *
 * On `agy` 1.2.13 the stream's `system_message` step is a marker — it carries
 * no text at all. The envelope exists solely in the transcript, so a live run
 * that sees the marker re-reads the record by step index and normalizes it
 * exactly as the history path does. Null when the record is not there yet.
 */
export const readAntigravitySystemMessageAtStep = (
  conversationId: string | null,
  stepIndex: string,
): string | null => {
  const record = readRecordAtStep(
    conversationId,
    stepIndex,
    (candidate) => readOptionalString(candidate.type) === SYSTEM_MESSAGE_TYPE,
  );
  return record ? readOptionalString(record.content) ?? null : null;
};

/**
 * The result one tool step recorded, for the live path.
 *
 * The stream reports a finished tool step by its call's name and parameters,
 * with no media and no failure flag. The step's `GENERIC` record — the step the
 * live `tool` update names is the one that ran the call — carries both, and the
 * output, so a live card re-reads it once the step completes and shows what a
 * reload would. Null when the record is not there yet.
 */
export const readAntigravityToolResultAtStep = (
  conversationId: string | null,
  stepIndex: string,
): { content: string; isError: boolean; media?: AntigravityMediaItem[] } | null => {
  const record = readRecordAtStep(conversationId, stepIndex, isToolResultRecord);
  if (!record || !conversationId) {
    return null;
  }

  const media = readAntigravityMedia(conversationId, record);
  return { ...buildToolResult(record), ...(media ? { media } : {}) };
};

/**
 * Resolves one media request to a file on disk, or null when it must 404.
 *
 * Both parts come from a URL. The conversation id must be a single path
 * segment, and the file is a path inside that conversation's directory, in
 * `/`-separated segments none of which may be empty, `.`, contain `..`, or
 * carry a backslash or a colon — a backslash makes a two-segment traversal look
 * like one name under POSIX rules, and a colon is a drive prefix or an NTFS
 * stream. The file must also resolve, symlinks followed, back into the
 * conversation's directory: a request is either for a file `agy` keeps for
 * this conversation or it is not.
 *
 * A single segment is the form tool-result media have always been addressed by
 * — a file in `.tempmediaStorage` — so that directory is tried first and the
 * conversation's own directory second, where the model saves screenshots it
 * links from its prose.
 */
export const resolveAntigravityMediaFile = (
  conversationId: string,
  filePath: string,
): { filePath: string; mimeType: string } | null => {
  const segments = filePath.split('/');
  if (
    !conversationId
    || conversationId !== path.basename(conversationId)
    || conversationId.includes('..')
    || segments.some((segment) => !segment || segment === '.' || segment.includes('..') || /[\\:]/.test(segment))
  ) {
    return null;
  }

  const mimeType = ANTIGRAVITY_MEDIA_MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!mimeType) {
    return null;
  }

  const conversationDir = getAntigravityConversationDir(conversationId);
  const candidates = segments.length === 1
    ? [path.join(conversationDir, ANTIGRAVITY_MEDIA_DIR, segments[0]), path.join(conversationDir, segments[0])]
    : [path.join(conversationDir, ...segments)];
  for (const candidate of candidates) {
    try {
      // Containment on the real path: a symlink inside the conversation must
      // not lead a request out of it.
      const realPath = fsSync.realpathSync(candidate);
      if (
        realPath.startsWith(fsSync.realpathSync(conversationDir) + path.sep)
        && fsSync.statSync(realPath).isFile()
      ) {
        return { filePath: realPath, mimeType };
      }
    } catch {
      // Not there; the next candidate may be.
    }
  }
  return null;
};

const normalizeAntigravityRecord = (
  record: AnyRecord,
  sessionId: string,
  fallbackIndex: number,
  toolResults: AnyRecord[] = [],
  context: AntigravityRecordContext,
): NormalizedMessage[] => {
  const stepIndex = readStepIndex(record, fallbackIndex);
  const timestamp = readRecordTimestamp(record, context.previousTimestamp);
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

  const recordType = readOptionalString(record.type);
  if (recordType === SYSTEM_MESSAGE_TYPE) {
    // A subagent this conversation spawned reporting back is folded into the
    // container that spawned it; rendering the same body as prose again would
    // double it. A report from a conversation spawned elsewhere still renders.
    const envelope = parseSystemMessageEnvelope(readOptionalString(record.content) ?? '');
    if (envelope?.sender && context.spawnedIds.has(envelope.sender)) {
      return [];
    }

    const systemMessage = normalizeAntigravitySystemMessage({
      content: readOptionalString(record.content) ?? '',
      id: buildAntigravityMessageId(sessionId, stepIndex, 'system'),
      sessionId,
      timestamp,
    });
    return systemMessage ? [systemMessage] : [];
  }

  // Type alone decides: `CHECKPOINT` has only ever meant a compaction, and a
  // future meaning mismatch degrades to a mislabelled divider, never to the
  // wall of resume-prompt text the record carries.
  if (recordType === CHECKPOINT_TYPE) {
    return [buildAntigravityCompactBoundary(sessionId, stepIndex, sessionId, timestamp)];
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
    messages.push(createNormalizedMessage({
      id: `${baseId}-text`,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'text',
      role: 'assistant',
      content: rewriteAntigravityImageLinks(content, context.conversationId),
    }));
  }

  toolCalls.forEach((call, callIndex) => {
    const result = toolResults[callIndex];
    // Keyed on the step that *ran* the call — its result record — because that
    // is the step the live stream's `tool` update names. Calls execute in the
    // steps right after the one that made them, so a call whose result never
    // arrived still gets the id its live card had.
    const executionStep = result
      ? readStepIndex(result, stepIndex + 1 + callIndex)
      : stepIndex + 1 + callIndex;
    const toolId = buildAntigravityMessageId(sessionId, executionStep, 'tool');
    const callName = readOptionalString(call.name) ?? 'Tool';
    const resultInfo = result ? buildToolResult(result) : null;

    // A spawn renders as one SubagentPanel container per agent it started, not
    // as a plain tool card: the agent's own transcript is its timeline and its
    // report — a system message the parent received later — is the result.
    if (callName === 'invoke_subagent') {
      const specs = readAgySubagentSpecs(readToolInput(call));
      const subIds = readAgySubagentConversationIds(
        result ? (readOptionalString(result.content) ?? null) : null,
      );
      specs.forEach((spec, index) => {
        const subId = subIds[index];
        const report = subId ? context.reports.get(subId) : undefined;
        // Several agents in one call need distinct ids; the first keeps the
        // call's own so the live card prunes against it.
        const containerId = specs.length > 1 ? `${toolId}-sub-${index}` : toolId;
        const containerMessage = createNormalizedMessage({
          id: containerId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: 'Task',
          toolInput: {
            subagent_type: spec.typeName || spec.role,
            description: spec.role,
            prompt: spec.prompt,
          },
          toolId: containerId,
        });

        if (report !== undefined) {
          containerMessage.toolResult = { content: report };
        } else if (resultInfo) {
          containerMessage.toolResult = {
            content: resultInfo.content,
            isError: resultInfo.isError,
          };
        }

        containerMessage.subagent = {
          id: subId ?? containerId,
          name: spec.role,
          type: spec.typeName || undefined,
          description: spec.role,
          status: report !== undefined ? 'completed' : 'running',
          ...(spec.model && spec.model !== 'inherit' ? { model: spec.model } : {}),
        };

        if (subId) {
          const timeline = readAntigravitySubagentTimeline(subId);
          if (timeline) {
            containerMessage.subagentTools = timeline.activity;
            if (containerMessage.subagent) {
              containerMessage.subagent.activityCount = timeline.count;
            }
          }
        }

        messages.push(containerMessage);
      });
      return;
    }

    const mapped = mapAntigravityTool(callName, readToolInput(call), resultInfo?.content ?? null);
    // The document card renders its body as markdown, so its screenshots need
    // the same addressing as prose.
    if (mapped.toolName === AGY_ARTIFACT_DOC_TOOL && typeof mapped.input.content === 'string') {
      mapped.input.content = rewriteAntigravityImageLinks(mapped.input.content, context.conversationId);
    }
    const toolMessage = createNormalizedMessage({
      id: toolId,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'tool_use',
      toolName: mapped.toolName,
      toolInput: mapped.input,
      toolId,
    });

    if (resultInfo) {
      const media = readAntigravityMedia(context.conversationId, result);
      toolMessage.toolResult = { ...resultInfo, ...(media ? { media } : {}) };
      // The answers ride on the result as `A1: …` lines; folding them into the
      // input is what makes the card read as answered rather than unanswered.
      if (mapped.toolName === 'AskUserQuestion' && Array.isArray(mapped.input.questions)) {
        const answers = parseAgyQuestionAnswers(
          mapped.input.questions.filter((question): question is AnyRecord => Boolean(readObjectRecord(question))),
          resultInfo.content,
        );
        if (Object.keys(answers).length > 0) {
          toolMessage.toolInput = { ...mapped.input, answers };
        }
      }
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
 *
 * It also drops the prompt `agy` re-injects after its backend restarts: a
 * prompt identical to the last one, with no assistant text in between, is not
 * shown twice. A deliberate re-send after a reply still is. The rule reads the
 * previous prompt, so it relies on the records arriving in step order.
 */
const normalizeAntigravityRecords = (
  records: AnyRecord[],
  sessionId: string,
  conversationId: string,
): NormalizedMessage[] => {
  const subagents = collectAntigravitySubagentContext(records);
  const consumed = new Set<number>();
  const messages: NormalizedMessage[] = [];
  let lastPrompt: string | null = null;
  let repliedSinceLastPrompt = false;
  let previousTimestamp: string | null = null;

  for (let index = 0; index < records.length; index += 1) {
    if (consumed.has(index)) {
      continue;
    }

    const record = records[index];
    if (isUserRecord(record)) {
      const prompt = unwrapUserRequest(readOptionalString(record.content) ?? '');
      if (prompt === lastPrompt && !repliedSinceLastPrompt) {
        continue;
      }
    }

    const toolResults: AnyRecord[] = [];
    const expectedResults = readToolCalls(record).length;
    for (let next = index + 1; next < records.length && toolResults.length < expectedResults; next += 1) {
      if (!isToolResultRecord(records[next])) {
        break;
      }

      toolResults.push(records[next]);
      consumed.add(next);
    }

    const context: AntigravityRecordContext = {
      ...subagents,
      previousTimestamp,
      conversationId,
    };
    const normalized = normalizeAntigravityRecord(record, sessionId, index, toolResults, context);
    const timestamp = readRecordTimestamp(record, previousTimestamp);
    if (timestamp) {
      previousTimestamp = timestamp;
    }

    for (const message of normalized) {
      if (message.kind === 'text' && message.role === 'user') {
        lastPrompt = unwrapUserRequest(readOptionalString(record.content) ?? '');
        repliedSinceLastPrompt = false;
      } else if (message.kind === 'text' && message.role === 'assistant') {
        repliedSinceLastPrompt = true;
      }
    }
    messages.push(...normalized);
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

    // A single record has no conversation to cross-reference: no subagent
    // context, and media urls cannot be built without the conversation id.
    return normalizeAntigravityRecord(record, sessionId ?? '', 0, [], {
      spawnedIds: new Set<string>(),
      reports: new Map<string, string>(),
      previousTimestamp: null,
      conversationId: '',
    });
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
      const normalized = normalizeAntigravityRecords(records, sessionId, providerSessionId);

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
