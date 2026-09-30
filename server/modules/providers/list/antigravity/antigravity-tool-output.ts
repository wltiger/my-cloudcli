/**
 * Antigravity tool-output cleanup
 * ===============================
 *
 * `agy` wraps every tool result in scaffolding that is not the output: a
 * `Created At`/`Completed At` header, a view-file note about line numbers, and
 * — for a command it pushed to the background — an instruction block addressed
 * to the model itself. This strips that scaffolding on the history and the
 * live path alike, so the card shows what the tool actually said.
 *
 * Deliberately conservative: only whole lines with a known prefix are removed,
 * and the instruction block is cut at its first line. Anything unrecognized is
 * left in place — a wording drift should read as noise, not swallow the result.
 */

/** Whole-line scaffolding `agy` prefixes a result with. */
const BOILERPLATE_LINE_PATTERN = /^(?:Created At|Completed At|File Path|Total Lines|Total Bytes|Showing lines)[^:]*:.*/;

/**
 * The instruction block a background command's result appends, addressed to the
 * agent rather than the user. Cut at its first line, which is stable enough to
 * anchor on without matching the output itself.
 */
const MODEL_INSTRUCTION_MARKER = 'YOU MUST TAKE ONE OF THE FOLLOWING TWO ACTIONS';

export const cleanAntigravityToolOutput = (content: string | null | undefined): string => {
  if (!content) {
    return '';
  }

  let text = content;
  const instructionIndex = text.indexOf(MODEL_INSTRUCTION_MARKER);
  if (instructionIndex !== -1) {
    text = text.slice(0, instructionIndex);
  }

  return text
    .split(/\r?\n/)
    .filter((line) => !BOILERPLATE_LINE_PATTERN.test(line))
    .join('\n')
    .trim();
};
