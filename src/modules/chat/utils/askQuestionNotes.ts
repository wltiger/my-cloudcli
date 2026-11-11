/**
 * Notes a user adds to an AskUserQuestion answer. Claude takes them as
 * `annotations[question].notes`, a field its CLI forwards to the model as
 * `"<question>"="<answer>" notes: <notes>`. OpenCode has no such field, so the
 * panel sends them as one trailing `notes: …` entry in that question's label
 * list, and the backend splits that entry back out for the question card.
 */
export const NOTES_LABEL_PREFIX = 'notes: ';

/**
 * The trimmed notes recorded for one question, or '' when there are none.
 * Annotations come from transcripts, so any shape is tolerated; an entry with
 * only a `preview` (answered in the terminal) has no notes.
 */
export const readQuestionNotes = (annotations: unknown, question: unknown): string => {
  if (!annotations || typeof annotations !== 'object' || typeof question !== 'string') {
    return '';
  }
  const entry = (annotations as Record<string, unknown>)[question];
  if (!entry || typeof entry !== 'object') {
    return '';
  }
  const notes = (entry as { notes?: unknown }).notes;
  return typeof notes === 'string' ? notes.trim() : '';
};
