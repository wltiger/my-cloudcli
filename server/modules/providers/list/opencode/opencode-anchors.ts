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
 * The columns of one joined message/part row that the Anchor rule reads. The
 * history query in `opencode-sessions.provider.ts` selects more than this; the
 * extra columns say nothing about where a turn ends.
 */
type OpenCodeAnchorRow = {
  message_id: string;
  message_data: string | null;
  part_data: string | null;
};

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
  // The history query returns one row per *part*, so collapse it back to the
  // messages an anchor can actually name. A Map keeps first-seen order.
  const messages = new Map<string, { role: string; isCompaction: boolean }>();
  for (const row of rows) {
    let message = messages.get(row.message_id);
    if (!message) {
      message = {
        role: readOptionalString(readJsonRecord(row.message_data)?.role) ?? '',
        isCompaction: false,
      };
      messages.set(row.message_id, message);
    }
    if (readOptionalString(readJsonRecord(row.part_data)?.type) === 'compaction') {
      message.isCompaction = true;
    }
  }

  const ordered = [...messages.entries()];
  let lastCompactionIndex = -1;
  for (let index = ordered.length - 1; index >= 0; index--) {
    if (ordered[index][1].isCompaction) {
      lastCompactionIndex = index;
      break;
    }
  }

  // Walking backwards carries "the next message that opens a turn" along, so
  // every message of a turn ends up with the same anchor in one pass.
  const anchors = new Map<string, string>();
  let nextTurnStart = OPENCODE_SESSION_END_ANCHOR;
  for (let index = ordered.length - 1; index > lastCompactionIndex; index--) {
    anchors.set(ordered[index][0], nextTurnStart);
    if (opensTurn(ordered, index)) {
      nextTurnStart = ordered[index][0];
    }
  }

  return anchors;
}

/**
 * True unless this message continues the assistant turn the message before it
 * started. Everything else — a user prompt, the first assistant message
 * answering one, OpenCode's synthetic compaction message — opens a turn.
 */
function opensTurn(
  ordered: [string, { role: string }][],
  index: number,
): boolean {
  return !(ordered[index][1].role === 'assistant' && ordered[index - 1]?.[1].role === 'assistant');
}
