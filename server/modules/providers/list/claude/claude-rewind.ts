import type { AnyRecord } from '@/shared/types.js';

import { findLastCompactBoundaryIndex } from './claude-anchors.js';

/**
 * The two Claude-specific rules a Rewind needs, kept together because both
 * turn on the same question — which transcript rows the provider's own
 * conversation chain is made of.
 *
 * Consumed by `claude-sessions.provider.ts`.
 */

/**
 * True for a row the SDK's own branch reader would return.
 *
 * Measured against SDK 0.3.165: `getSessionMessages` keeps `user` and
 * `assistant` rows and drops meta, sidechain and every other row type
 * (`attachment`, `ai-title`, `last-prompt`, `queue-operation`, `mode`,
 * `system`). Both rules below need this: an anchor must be a row
 * `resumeSessionAt` can find, and a row the reader never returns must never be
 * mistaken for one it dropped as abandoned.
 */
function isBranchResolvableRow(row: AnyRecord): boolean {
  return (row.type === 'user' || row.type === 'assistant')
    && row.isMeta !== true
    && row.isSidechain !== true;
}

/**
 * Computes the Rewind Anchor of every Claude transcript row that has one.
 *
 * This is deliberately a **second** rule alongside `buildClaudeAnchorIndex`,
 * not a generalization of it. Both are anchors on the same provider and they
 * disagree: `forkSession` takes a turn's **last** row, while `resumeSessionAt`
 * is inclusive of the row it names, so rewinding *to* a message means
 * anchoring on the row **before** it.
 *
 * - Only the reader's own messages get one — Rewind is offered on user rows
 *   only, unlike Fork.
 * - The row before is read off the `parentUuid` chain rather than off file
 *   order, because a turn's rows are interleaved with tool results. The walk
 *   climbs past rows the SDK would not return (an `attachment` row written for
 *   a pasted image sits directly between a prompt and the turn above it), so
 *   the anchor is always a uuid `resumeSessionAt` can resolve.
 * - Rows at or before the last compaction boundary get nothing: an anchor from
 *   before a Compact fails hard (`No message found with message.uuid of: ...`).
 *   That also covers the first prompt after a boundary, whose whole chain lies
 *   above it, and the very first prompt of a session, which has no row before
 *   it at all.
 *
 * @param rows Raw transcript rows in file order, as read from the session JSONL.
 * @returns Row uuid -> anchor uuid. A row absent from the map has no anchor.
 */
export function buildClaudeRewindAnchorIndex(rows: AnyRecord[]): Map<string, string> {
  const lastCompactBoundaryIndex = findLastCompactBoundaryIndex(rows);

  const rowIndexByUuid = new Map<string, number>();
  for (let index = 0; index < rows.length; index++) {
    const uuid = rows[index].uuid;
    if (typeof uuid === 'string' && uuid) {
      rowIndexByUuid.set(uuid, index);
    }
  }

  const anchors = new Map<string, string>();
  for (let index = lastCompactBoundaryIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const uuid = typeof row.uuid === 'string' ? row.uuid : '';
    if (!uuid || row.type !== 'user' || !isBranchResolvableRow(row)) {
      continue;
    }

    let parentUuid = typeof row.parentUuid === 'string' ? row.parentUuid : '';
    while (parentUuid) {
      const parentIndex = rowIndexByUuid.get(parentUuid);
      if (parentIndex === undefined || parentIndex <= lastCompactBoundaryIndex) {
        break;
      }
      const parent = rows[parentIndex];
      if (isBranchResolvableRow(parent)) {
        anchors.set(uuid, parentUuid);
        break;
      }
      parentUuid = typeof parent.parentUuid === 'string' ? parent.parentUuid : '';
    }
  }

  return anchors;
}

/**
 * Drops the rows a Rewind abandoned, so a reload shows the conversation as it
 * now stands instead of both branches at once.
 *
 * A Rewind does not rewrite the transcript: the new turn is appended to the
 * same file with its `parentUuid` pointing back at the anchor, so the file
 * becomes a tree and CloudCLI's flat reader goes on rendering the branch that
 * was left behind.
 *
 * Per ADR 0007 the filter is applied **only after the last compaction
 * boundary**. The SDK's branch reader resolves the active branch correctly but
 * also discards everything before that boundary, which would take the
 * compaction marker and all the history above it off the screen. Since a
 * Rewind anchor from before a Compact cannot resolve at all, no abandoned
 * branch can exist there, and that segment renders flat exactly as it does
 * today.
 *
 * @param rows Raw transcript rows in file order.
 * @param activeRowUuids Uuids of the active branch, from the SDK's
 *   `getSessionMessages`. Empty means the branch could not be read, and
 *   nothing is filtered — losing the whole conversation is far worse than an
 *   abandoned branch staying visible.
 */
export function filterClaudeAbandonedBranchRows(
  rows: AnyRecord[],
  activeRowUuids: Set<string>,
): AnyRecord[] {
  if (activeRowUuids.size === 0) {
    return rows;
  }

  const lastCompactBoundaryIndex = findLastCompactBoundaryIndex(rows);

  return rows.filter((row, index) => {
    if (index <= lastCompactBoundaryIndex || !isBranchResolvableRow(row)) {
      return true;
    }
    return typeof row.uuid === 'string' && activeRowUuids.has(row.uuid);
  });
}
