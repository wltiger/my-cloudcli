import { readJsonRecord, readOptionalString } from '@/shared/utils.js';

/**
 * The Anchor that names the end of a session rather than a message in it.
 *
 * The newest turn has no message after it to name, and OpenCode's fork copies
 * the whole session when it is sent no `messageID` at all (measured against
 * 1.18.18) — which is exactly "ends at the last turn". `forkOpenCodeSession` in
 * `opencode-runtime.provider.js` reads this constant to decide which of the two
 * request bodies to send, so the newest messages stay forkable instead of being
 * the one place the entry silently disappears.
 */
export const OPENCODE_SESSION_END_ANCHOR = 'opencode:session-end';

/**
 * The columns of one joined message/part row that the Anchor rules read. The
 * history query in `opencode-sessions.provider.ts` selects more than this; the
 * extra columns say nothing about where a turn ends.
 *
 * Exported for `opencode-rewind.ts`, which reads the same rows under the
 * opposite convention.
 */
export type OpenCodeAnchorRow = {
  message_id: string;
  message_data: string | null;
  part_data: string | null;
};

/**
 * One OpenCode message, collapsed back out of the per-part rows the history
 * query returns.
 */
export type OpenCodeMessageSummary = {
  id: string;
  role: string;
  isCompaction: boolean;
};

/**
 * Collapses per-part rows into the messages an Anchor can name, in first-seen
 * order, and locates the last compaction among them.
 *
 * Exported for `opencode-rewind.ts`: the fork rule, the rewind rule and the
 * revert filter all need this same collapse and this same boundary, and three
 * private copies of it would drift. It is the counterpart of
 * `claude-anchors.ts` exporting `findLastCompactBoundaryIndex` to
 * `claude-rewind.ts` — one shared scan, three rules that stay separate.
 *
 * @param rows Joined message/part rows in the order the history query returns.
 * @returns The collapsed messages and the index of the last compaction among
 *   them, or -1 when the session has never been compacted.
 */
export function readOpenCodeMessageIndex(rows: OpenCodeAnchorRow[]): {
  messages: OpenCodeMessageSummary[];
  lastCompactionIndex: number;
} {
  // A Map keeps first-seen order, which is the order the query returned.
  const byId = new Map<string, OpenCodeMessageSummary>();
  for (const row of rows) {
    let message = byId.get(row.message_id);
    if (!message) {
      message = {
        id: row.message_id,
        role: readOptionalString(readJsonRecord(row.message_data)?.role) ?? '',
        isCompaction: false,
      };
      byId.set(row.message_id, message);
    }
    if (readOptionalString(readJsonRecord(row.part_data)?.type) === 'compaction') {
      message.isCompaction = true;
    }
  }

  const messages = [...byId.values()];
  let lastCompactionIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].isCompaction) {
      lastCompactionIndex = index;
      break;
    }
  }

  return { messages, lastCompactionIndex };
}

/**
 * Computes the Anchor of every OpenCode message in a session.
 *
 * Consumed by `opencode-sessions.provider.ts`, which stamps each normalized
 * message with the anchor of the message it came from, so the frontend can
 * offer Fork without ever resolving an anchor itself.
 *
 * This is deliberately *not* Claude's rule, and the two must not be merged.
 * `POST /session/{id}/fork` is **exclusive**: given a message, it produces a
 * session that ends *before* it (measured against a real 1.18.18 session, where
 * forking at the message closing a turn dropped that turn's reply). So keeping
 * a turn means naming the message that comes *after* it, one row further on
 * than Claude's inclusive `forkSession` lands. OpenCode's own `revert`
 * disagrees again by including the message it is given, which is why an anchor
 * is an opaque per-provider token and never a shared rule.
 *
 * A turn here is a user prompt on its own, or a run of consecutive assistant
 * messages: one agent turn is written as several messages when it uses tools
 * (measured: a turn that wrote a file came back as a tool-call message plus a
 * reply-text message), so anchoring on the next *message* rather than the next
 * *turn* would truncate it.
 *
 * Messages at or before the last compaction get no anchor at all, the same
 * conservative rule `buildClaudeAnchorIndex` applies.
 *
 * @param rows Joined message/part rows in the order the history query returns.
 * @returns OpenCode message id -> anchor. A message absent from the map has no
 *   anchor and offers no Fork.
 */
export function buildOpenCodeAnchorIndex(rows: OpenCodeAnchorRow[]): Map<string, string> {
  const { messages, lastCompactionIndex } = readOpenCodeMessageIndex(rows);

  // Walking backwards carries "the next message that opens a turn" along, so
  // every message of a turn ends up with the same anchor in one pass.
  const anchors = new Map<string, string>();
  let nextTurnStart = OPENCODE_SESSION_END_ANCHOR;
  for (let index = messages.length - 1; index > lastCompactionIndex; index--) {
    anchors.set(messages[index].id, nextTurnStart);
    if (opensTurn(messages, index)) {
      nextTurnStart = messages[index].id;
    }
  }

  return anchors;
}

/**
 * True unless this message continues the assistant turn the message before it
 * started. Everything else — a user prompt, the first assistant message
 * answering one, OpenCode's synthetic compaction message — opens a turn.
 */
function opensTurn(messages: OpenCodeMessageSummary[], index: number): boolean {
  return !(messages[index].role === 'assistant' && messages[index - 1]?.role === 'assistant');
}
