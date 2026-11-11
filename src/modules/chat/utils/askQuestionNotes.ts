/**
 * Notes a user adds to an AskUserQuestion answer. Claude takes them as
 * `annotations[question].notes`, a field its CLI forwards to the model as
 * `"<question>"="<answer>" notes: <notes>`. OpenCode has no such field, so the
 * panel sends them as one trailing `notes: …` entry in that question's label
 * list, and the backend splits that entry back out for the question card
 * (`NOTES_LABEL_PREFIX` in `opencode-question-notes.ts` — keep the two equal).
 *
 * A fork-owned module on purpose: the repo standards would put a two-consumer
 * helper in `src/shared/utils.ts` and inline a one-consumer constant, but this
 * fork keeps its additions out of upstream-owned files (fork-customizations #40).
 */

/** Used by chat's useAskQuestionNotes to build OpenCode's trailing notes label. */
export const NOTES_LABEL_PREFIX = 'notes: ';

/**
 * Used by chat's QuestionAnswerContent and the AskUserQuestion tool config to
 * read the trimmed notes recorded for one question, or '' when there are none.
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
