/**
 * The chat panel sends a question's notes to OpenCode as one trailing
 * `notes: …` entry in that question's label list, since OpenCode's question
 * tool has no field for them (the model reads `"<q>"="<label>, notes: …"`).
 * Only a trailing entry counts, so a label that merely starts with the prefix
 * elsewhere in the list stays an answer.
 *
 * Same name and value as the frontend's `NOTES_LABEL_PREFIX`
 * (`src/modules/chat/utils/askQuestionNotes.ts`) — keep the two equal.
 */
const NOTES_LABEL_PREFIX = 'notes: ';

/**
 * Used by `toAskUserQuestionCall` in opencode-sessions.provider.ts to split
 * the trailing notes entry, if any, off one question's picked labels.
 */
export function splitQuestionNotes(labels: string[]): { labels: string[]; notes: string } {
  const last = labels[labels.length - 1];
  if (typeof last !== 'string' || !last.startsWith(NOTES_LABEL_PREFIX)) {
    return { labels, notes: '' };
  }
  return { labels: labels.slice(0, -1), notes: last.slice(NOTES_LABEL_PREFIX.length).trim() };
}
