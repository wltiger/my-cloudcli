import type { OpenCodeAnchorRow } from './opencode-anchors.js';
import { readOpenCodeMessageIndex } from './opencode-anchors.js';

/**
 * The two OpenCode-specific rules a Rewind needs, kept together because both
 * turn on the same measured fact: `POST /session/{id}/revert` is inclusive of
 * the message it is given, and OpenCode keeps every message it reverted.
 *
 * Consumed by `opencode-sessions.provider.ts`.
 */

/**
 * Computes the Rewind Anchor of every OpenCode message that has one.
 *
 * This is a **third** concrete rule, not a generalization of the other two. It
 * disagrees with `buildOpenCodeAnchorIndex` on the same provider and the same
 * gesture shape: `POST /session/{id}/fork` **excludes** the message it is given
 * so a Fork anchors on the first message of the *next* turn, while
 * `POST /session/{id}/revert` **includes** it, so a Rewind anchors on the
 * message itself. Measured against a real 1.18.18 server: reverting at the user
 * message that opened a turn dropped that message and everything after it.
 * That is why an Anchor is an opaque per-provider token and the three rules
 * must stay separately readable.
 *
 * - Only the reader's own messages get one — Rewind is offered on user rows
 *   only, unlike Fork.
 * - The first prompt of a session gets one too, unlike Claude's rule, which has
 *   no row before it to name. Rewinding it empties the session and rolls every
 *   tracked file back with it, which is a legitimate thing to ask for.
 * - Messages at or before the last compaction get none, the same conservative
 *   rule `buildOpenCodeAnchorIndex` applies. It is load-bearing twice over
 *   here: `filterOpenCodeRevertedRows` refuses to touch that segment (ADR
 *   0007), so an anchor there would revert server-side and still render every
 *   message it reverted.
 *
 * @param rows Joined message/part rows in the order the history query returns.
 * @returns OpenCode message id -> anchor. A message absent from the map has no
 *   anchor and offers no Rewind.
 */
export function buildOpenCodeRewindAnchorIndex(rows: OpenCodeAnchorRow[]): Map<string, string> {
  const { messages, lastCompactionIndex } = readOpenCodeMessageIndex(rows);

  const anchors = new Map<string, string>();
  for (let index = lastCompactionIndex + 1; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'user' && !message.isCompaction) {
      anchors.set(message.id, message.id);
    }
  }

  return anchors;
}

/**
 * Drops the rows a Rewind reverted, so a reload shows the conversation as it
 * now stands.
 *
 * OpenCode does **not** filter these out of its own read API: measured on a
 * seven-message session, `GET /session/{id}/message` still returned all seven
 * after a revert and all seven rows stayed in `opencode.db`. What the revert
 * changes is one column on the session row — `revert`, holding the message id
 * it was taken at plus the git snapshot and the diff it undid. So filtering the
 * history is CloudCLI's job here exactly as it is on Claude, and skipping it
 * ships a visible "the old messages came back" bug on every reload.
 *
 * Per ADR 0007 the filter applies **only after the last compaction boundary**,
 * matching Claude's. A revert taken before one leaves the whole conversation
 * rendering flat with its boundary marker intact, which is the better of the
 * two trades; `buildOpenCodeRewindAnchorIndex` offers no anchor there anyway,
 * so CloudCLI cannot produce that state itself.
 *
 * @param rows Joined message/part rows in the order the history query returns.
 * @param revertedMessageId `revert.messageID` off the session row, or null when
 *   the session is not reverted.
 */
export function filterOpenCodeRevertedRows<Row extends OpenCodeAnchorRow>(
  rows: Row[],
  revertedMessageId: string | null,
): Row[] {
  if (!revertedMessageId) {
    return rows;
  }

  const { messages, lastCompactionIndex } = readOpenCodeMessageIndex(rows);
  const revertedIndex = messages.findIndex((message) => message.id === revertedMessageId);
  // One comparison covers both refusals: a revert from at or before the last
  // boundary, and a message id these rows do not contain at all (-1, which is
  // never greater than a boundary index that is itself at least -1).
  if (revertedIndex <= lastCompactionIndex) {
    return rows;
  }

  // A turn spans several messages, so this drops whole messages rather than
  // rows — the reader must never be shown half a turn.
  const reverted = new Set(messages.slice(revertedIndex).map((message) => message.id));
  return rows.filter((row) => !reverted.has(row.message_id));
}
