import type { AnyRecord } from '@/shared/types.js';

import { findLastCompactBoundaryIndex } from './claude-anchors.js';

/**
 * The Claude-specific rule for reading back a transcript an edit rewound.
 *
 * Consumed by `claude-sessions.provider.ts`.
 */

/**
 * True for a row the SDK's own branch reader would return.
 *
 * Measured against SDK 0.3.165: `getSessionMessages` keeps `user` and
 * `assistant` rows and drops meta, sidechain and every other row type
 * (`attachment`, `ai-title`, `last-prompt`, `queue-operation`, `mode`,
 * `system`). The filter below needs this: a row the reader never returns must
 * never be mistaken for one it dropped as abandoned.
 */
function isBranchResolvableRow(row: AnyRecord): boolean {
  return (row.type === 'user' || row.type === 'assistant')
    && row.isMeta !== true
    && row.isSidechain !== true;
}

/**
 * Drops the rows an edit abandoned, so a reload shows the conversation as it
 * now stands instead of both branches at once.
 *
 * Editing does not rewrite the transcript: the replacement turn is appended to
 * the same file with its `parentUuid` pointing back at the resume anchor, so
 * the file becomes a tree and CloudCLI's flat reader goes on rendering the
 * branch that was left behind.
 *
 * Per ADR 0007 the filter is applied **only after the last compaction
 * boundary**. The SDK's branch reader resolves the active branch correctly but
 * also discards everything before that boundary, which would take the
 * compaction marker and all the history above it off the screen. Since a
 * resume anchor from before a Compact cannot resolve at all, no abandoned
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
