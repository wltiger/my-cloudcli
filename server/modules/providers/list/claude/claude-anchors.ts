import type { AnyRecord } from '@/shared/types.js';

/**
 * Computes the Anchor of every Claude transcript row.
 *
 * Consumed by `claude-sessions.provider.ts`, which stamps each normalized
 * message with the anchor of the row it came from, so the frontend can offer
 * Fork (and later Rewind) without ever resolving an anchor itself.
 *
 * Two measured facts about Claude decide the whole shape of this:
 *
 * - One agent turn is written as *several* transcript rows — reasoning, text,
 *   one per tool call — all sharing the same `message.id`. `forkSession` takes
 *   its `upToMessageId` **inclusive**, so a turn's anchor is its **last** row;
 *   anchoring at the first row silently drops the rest of the turn. Rows of one
 *   turn are not necessarily adjacent: an assistant message issuing two tool
 *   calls has each tool result written between its two `tool_use` rows, so the
 *   grouping is by `message.id` across the whole transcript, not by run.
 * - An anchor from before a Compact no longer resolves (`resumeSessionAt` fails
 *   hard on an unresolvable uuid). Every row up to and including the last
 *   compaction boundary is therefore left out of the index entirely, and the
 *   frontend offers no entry on the messages they produced.
 *
 * Rows the provider writes alongside the conversation (`ai-title`,
 * `last-prompt`, `queue-operation`) carry no uuid and are simply skipped.
 *
 * @param rows Raw transcript rows in file order, as read from the session JSONL.
 * @returns Row uuid -> anchor uuid. A row absent from the map has no anchor.
 */
export function buildClaudeAnchorIndex(rows: AnyRecord[]): Map<string, string> {
  let lastCompactBoundaryIndex = -1;
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].type === 'system' && rows[index].subtype === 'compact_boundary') {
      lastCompactBoundaryIndex = index;
      break;
    }
  }

  // Last row wins, so a plain forward pass leaves each turn pointing at its end.
  const turnLastRowUuid = new Map<string, string>();
  for (let index = lastCompactBoundaryIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const uuid = typeof row.uuid === 'string' ? row.uuid : '';
    if (!uuid) {
      continue;
    }
    turnLastRowUuid.set(readTurnKey(row, uuid), uuid);
  }

  const anchors = new Map<string, string>();
  for (let index = lastCompactBoundaryIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const uuid = typeof row.uuid === 'string' ? row.uuid : '';
    if (!uuid) {
      continue;
    }
    anchors.set(uuid, turnLastRowUuid.get(readTurnKey(row, uuid)) ?? uuid);
  }

  return anchors;
}

/**
 * Groups rows into turns. Assistant rows of one API message share
 * `message.id`; everything else (user prompts, tool results, meta rows) is a
 * turn of its own, keyed by its own uuid so it can never collide with them.
 */
function readTurnKey(row: AnyRecord, uuid: string): string {
  const messageId = row.message?.id;
  return typeof messageId === 'string' && messageId ? `msg:${messageId}` : `row:${uuid}`;
}
