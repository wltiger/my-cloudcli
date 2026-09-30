/**
 * Antigravity tool-name and argument mapping
 * ===========================================
 *
 * `agy` names its tools after its own internal actions (`view_file`,
 * `run_command`, …) with PascalCase arguments, and stores **every** argument
 * as its own JSON literal string. None of that matches the canonical Claude
 * tool names and key spellings the frontend renders, so this module is the one
 * place that folds both onto the canonical shape. The transcript reader and the
 * live stream fold both call it, which is what makes one call render the same
 * row live and after a reload.
 *
 * The same rename-at-normalization approach the Codex provider already uses
 * for `update_plan` → `TodoWrite` is the precedent: the provider owns its
 * display identity and the frontend registry stays provider-agnostic.
 *
 * Only the display shape changes here. Ids, pairing and result text stay the
 * reader's concern.
 *
 * Arg shapes were measured against real `transcript.jsonl` records — the file
 * the reader actually reads, not `transcript_full.jsonl`, which stores native
 * JSON values and would predict the wrong shape for every non-string argument.
 */

import type { AnyRecord } from '@/shared/types.js';
import { readObjectRecord, readOptionalString, unwrapJsonStringLiteral } from '@/shared/utils.js';

/** Canonical name of the `manage_task` card (fork-owned config). */
export const AGY_TASK_TOOL = 'AgyTask';
/** Canonical name of the `schedule` card (fork-owned config). */
export const AGY_SCHEDULE_TOOL = 'AgySchedule';
/** Canonical name of the `manage_subagents` card (fork-owned config). */
export const AGY_SUBAGENTS_TOOL = 'AgySubagents';
/** Canonical name of the `send_message` card (fork-owned config). */
export const AGY_MESSAGE_TOOL = 'AgyMessage';
/** Canonical name of the `generate_image` card (fork-owned config). */
export const AGY_IMAGE_TOOL = 'AgyImage';
/** A `write_to_file` whose artifact is user-facing renders as a doc card, not a diff. */
export const AGY_ARTIFACT_DOC_TOOL = 'AgyArtifactDoc';
/** A spawned subagent's container; the frontend routes any `Task` row to SubagentPanel. */
const SUBAGENT_CONTAINER_TOOL = 'Task';

const isRecord = (value: unknown): value is AnyRecord => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

/** `RunCommand` → `run_command`: the stream and the transcript differ in case. */
const toSnakeCase = (value: string): string => (
  value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
);

/**
 * Fully decodes one stored argument: objects, arrays, booleans and numbers.
 *
 * Every argument in the transcript is a JSON literal string, including the
 * structured ones. The shared unwrapping helper only decodes values that decode
 * *to a string*, so `ArtifactMetadata`, `Subagents` and `IsDaemon` all survive
 * as strings unless something like this runs.
 */
const decodeArgument = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    // A doubly-encoded flag (`"\"true\""`) decodes to the string `"true"` on
    // the first pass; decode again so the flag is a real boolean.
    return typeof parsed === 'string' ? decodeArgument(parsed) : parsed;
  } catch {
    return value;
  }
};

/**
 * Arguments that hold file content or free prose.
 *
 * These are never decoded: a file whose body is `{"name":"x"}`, `[1,2,3]`,
 * `12345` or `true` parses successfully, and the mapped `Write.content` /
 * `Edit.old_string` are typed as strings and split by line to build a diff — a
 * non-string there yields an empty diff or throws. An argument that holds
 * content is a string by definition, whatever it looks like.
 */
const CONTENT_ARGUMENT_KEYS = new Set([
  'CodeContent',
  'TargetContent',
  'ReplacementContent',
  'Description',
  'Instruction',
]);

/**
 * Boolean-valued arguments, decoded so `"false"` becomes false.
 *
 * Without this, `IsDaemon === true` never matches and a truthiness test marks
 * every command as background, because the string `"false"` is truthy.
 */
const BOOLEAN_ARGUMENT_KEYS = new Set([
  'IsDaemon',
  'Overwrite',
  'AllowMultiple',
]);

/**
 * Decodes one call's stored arguments.
 *
 * Targeted rather than blanket, in three bands:
 * - content-bearing keys lose their surrounding quotes but are never fully
 *   parsed, so a written package.json stays a string;
 * - boolean flags become real booleans;
 * - everything else is unwrapped to a string, or fully decoded when it is a
 *   structured value (an object or array literal).
 *
 * The last band matters twice over: `CommandLine` and `AbsolutePath` need their
 * quotes removed, while `ArtifactMetadata` and `Subagents` need a full parse —
 * and the same argument is never both.
 */
const decodeArguments = (args: AnyRecord): AnyRecord => (
  Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      // Content keys differ from the rest in one way only: they never get a
      // *full* parse, so a written package.json stays a string. They still lose
      // their surrounding quotes — the transcript stores them doubly encoded.
      if (CONTENT_ARGUMENT_KEYS.has(key)) {
        return [key, typeof value === 'string' ? unwrapJsonStringLiteral(value) : value];
      }

      if (BOOLEAN_ARGUMENT_KEYS.has(key)) {
        return [key, decodeArgument(value) === true];
      }

      if (typeof value !== 'string') {
        return [key, value];
      }

      const trimmed = value.trim();
      // A structured literal (object or array) needs the full parse; anything
      // else just needs its surrounding quotes removed, so a file body that
      // looks like JSON stays the string it is.
      const decoded = trimmed.startsWith('{') || trimmed.startsWith('[')
        ? decodeArgument(value)
        : unwrapJsonStringLiteral(value);
      return [key, decoded];
    }),
  )
);

/** Paths arrive with both separators; the diff-card titles split on `/`. */
const normalizePathSeparators = (value: string): string => value.replace(/\\/g, '/');

/** The tail of `conv-id/task-72` — the name every card and notice uses. */
export const readAgyTaskName = (taskId: unknown): string => {
  const value = readOptionalString(taskId) ?? '';
  const tail = value.slice(value.lastIndexOf('/') + 1);
  return tail || value;
};

/** True when a command was pushed to the background, by declaration or by timeout. */
const BACKGROUND_RESULT_PATTERN = /running as a background task/i;

export const isAntigravityBackgroundResult = (resultContent: string | null): boolean => (
  typeof resultContent === 'string' && BACKGROUND_RESULT_PATTERN.test(resultContent)
);

/**
 * The one-line secondary text for a background command.
 *
 * The badge rides in `description` because the `Bash` config reads only
 * `command` and `description`, the tool status union has no background state,
 * and `Bash` hides its result on success — a separate badge field would render
 * nothing at all.
 */
const describeBackground = (description: string | undefined, resultContent: string | null): string => {
  const taskMatch = resultContent ? /task id:\s*(\S+)/i.exec(resultContent) : null;
  const taskName = taskMatch ? readAgyTaskName(taskMatch[1]) : null;
  const prefix = `[background${taskName ? ` · ${taskName}` : ''}]`;
  return description ? `${prefix} ${description}` : prefix;
};

/**
 * A `write_to_file` whose artifact is user-facing renders as a document card.
 *
 * `ArtifactMetadata` may arrive decoded (an object) or still encoded (a
 * string), depending on which path and which transcript file supplied it.
 */
const readArtifactMetadata = (args: AnyRecord): AnyRecord | null => {
  const raw = args.ArtifactMetadata;
  const decoded = isRecord(raw) ? raw : readObjectRecord(decodeArgument(raw));
  return decoded?.UserFacing === true ? decoded : null;
};

/**
 * Maps one `agy` tool call onto its canonical display shape.
 *
 * Returns the (possibly new) tool name and the input the renderer reads. Names
 * with no entry pass through untouched: an unknown tool is a later release's,
 * and it still gets the Default card with its real name.
 */
export const mapAntigravityTool = (
  name: string,
  input: unknown,
  resultContent: string | null = null,
): { toolName: string; input: AnyRecord } => {
  const args = decodeArguments(readObjectRecord(input) ?? {});

  switch (toSnakeCase(name)) {
    case 'view_file':
      return {
        toolName: 'Read',
        input: {
          file_path: normalizePathSeparators(readOptionalString(args.AbsolutePath) ?? ''),
        },
      };

    case 'run_command': {
      const description = readOptionalString(args.toolSummary) ?? readOptionalString(args.toolAction);
      const background = args.IsDaemon === true || isAntigravityBackgroundResult(resultContent);
      return {
        toolName: 'Bash',
        input: {
          command: readOptionalString(args.CommandLine) ?? '',
          ...(background
            ? { description: describeBackground(description, resultContent) }
            : description ? { description } : {}),
        },
      };
    }

    case 'replace_file_content':
      return {
        toolName: 'Edit',
        input: {
          file_path: normalizePathSeparators(readOptionalString(args.TargetFile) ?? ''),
          old_string: readOptionalString(args.TargetContent) ?? '',
          new_string: readOptionalString(args.ReplacementContent) ?? '',
        },
      };

    case 'write_to_file': {
      const artifact = readArtifactMetadata(args);
      if (artifact) {
        return {
          toolName: AGY_ARTIFACT_DOC_TOOL,
          input: {
            file_path: normalizePathSeparators(readOptionalString(args.TargetFile) ?? ''),
            content: readOptionalString(args.CodeContent) ?? '',
            artifactTitle: readOptionalString(artifact.Summary)
              ?? readOptionalString(args.Description)
              ?? 'Document',
          },
        };
      }
      return {
        toolName: 'Write',
        input: {
          file_path: normalizePathSeparators(readOptionalString(args.TargetFile) ?? ''),
          content: readOptionalString(args.CodeContent) ?? '',
        },
      };
    }

    case 'manage_task':
      return {
        toolName: AGY_TASK_TOOL,
        input: {
          // `list` carries no task id; a naive split on it would throw and the
          // reader's catch would empty the whole conversation's history.
          taskName: readOptionalString(args.TaskId) ? readAgyTaskName(args.TaskId) : 'all tasks',
          action: readOptionalString(args.Action) ?? 'status',
        },
      };

    case 'schedule': {
      const cron = readOptionalString(args.CronExpression);
      const seconds = Number(args.DurationSeconds);
      const label = cron
        ?? (Number.isFinite(seconds) && seconds > 0 ? `${seconds}s` : 'timer');
      return {
        toolName: AGY_SCHEDULE_TOOL,
        input: { label, prompt: readOptionalString(args.Prompt) ?? '' },
      };
    }

    case 'manage_subagents':
      return {
        toolName: AGY_SUBAGENTS_TOOL,
        input: { action: readOptionalString(args.Action) ?? 'list' },
      };

    case 'send_message': {
      const recipient = readOptionalString(args.Recipient) ?? '';
      return {
        toolName: AGY_MESSAGE_TOOL,
        // The recipient is a conversation id; its head is how notices name it.
        input: { recipient: recipient.slice(0, 8) },
      };
    }

    case 'invoke_subagent':
      // The reader expands one call into one container per spawned agent; this
      // name only matters for a call it could not expand.
      return { toolName: SUBAGENT_CONTAINER_TOOL, input: args };

    case 'ask_question': {
      const rawQuestions = Array.isArray(args.questions) ? args.questions : [];
      return {
        toolName: 'AskUserQuestion',
        input: {
          questions: rawQuestions
            .filter((question): question is AnyRecord => isRecord(question))
            .map((question) => ({
              question: readOptionalString(question.question) ?? '',
              multiSelect: question.is_multi_select === true,
              options: (Array.isArray(question.options) ? question.options : [])
                .map((option) => (
                  typeof option === 'string'
                    ? { label: option }
                    : isRecord(option) ? option : null
                ))
                .filter((option): option is AnyRecord => option !== null),
            })),
        },
      };
    }

    case 'search_web':
      return { toolName: 'WebSearch', input: { query: readOptionalString(args.query) ?? '' } };

    case 'read_url_content':
      return {
        toolName: 'WebFetch',
        input: { url: readOptionalString(args.Url) ?? readOptionalString(args.URL) ?? '' },
      };

    case 'generate_image': {
      const imageName = readOptionalString(args.ImageName);
      const aspectRatio = readOptionalString(args.AspectRatio);
      return {
        toolName: AGY_IMAGE_TOOL,
        input: {
          prompt: readOptionalString(args.Prompt) ?? '',
          ...(imageName ? { name: imageName } : {}),
          ...(aspectRatio ? { aspectRatio } : {}),
        },
      };
    }

    case 'call_mcp_tool': {
      const server = readOptionalString(args.ServerName) ?? '';
      const tool = readOptionalString(args.ToolName) ?? 'tool';
      return { toolName: `mcp__${server}__${tool}`, input: args };
    }

    default:
      return { toolName: name, input: args };
  }
};

/** The per-agent entry inside an `invoke_subagent` call's `Subagents` array. */
export type AgySubagentSpec = {
  prompt: string;
  role: string;
  typeName: string;
  model?: string;
};

/**
 * The agents one `invoke_subagent` call spawned, in order.
 *
 * An empty or malformed array yields one agent with no details rather than
 * vanishing from the transcript.
 */
export const readAgySubagentSpecs = (input: unknown): AgySubagentSpec[] => {
  const args = readObjectRecord(input) ?? {};
  // `Subagents` may arrive still encoded as a JSON literal string.
  const decodedSubagents = decodeArgument(args.Subagents);
  const rawSubagents = Array.isArray(decodedSubagents) ? decodedSubagents : [];
  const specs = rawSubagents
    .filter((entry): entry is AnyRecord => isRecord(entry))
    .map((entry) => ({
      prompt: readOptionalString(entry.Prompt) ?? '',
      role: readOptionalString(entry.Role) ?? readOptionalString(entry.TypeName) ?? 'Subagent',
      typeName: readOptionalString(entry.TypeName) ?? '',
      model: readOptionalString(entry.Model),
    }));
  return specs.length > 0 ? specs : [{ prompt: '', role: 'Subagent', typeName: '' }];
};

/**
 * The conversation ids an `invoke_subagent` result announces, in order.
 *
 * The result embeds them as a JSON block (`"conversationId": "…"`) inside
 * prose, and the wording is not a contract — so the ids are scanned out of the
 * whole content rather than parsed from one position.
 */
export const readAgySubagentConversationIds = (resultContent: string | null): string[] => {
  if (!resultContent) {
    return [];
  }

  const ids: string[] = [];
  const pattern = /"conversationId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi;
  for (const match of resultContent.matchAll(pattern)) {
    if (!ids.includes(match[1])) {
      ids.push(match[1]);
    }
  }
  return ids;
};

/**
 * The answers an `ask_question` result reports, keyed by question text.
 *
 * Result lines read `A1: …`, where the ordinal indexes the question array; the
 * renderer looks answers up by the question's own text, so the two are joined
 * here. A skip is a real answer too — it says what did not happen.
 */
export const parseAgyQuestionAnswers = (
  questions: AnyRecord[],
  resultContent: string | null,
): Record<string, string> => {
  const answers: Record<string, string> = {};
  if (!resultContent) {
    return answers;
  }

  const byOrdinal: Record<number, string> = {};
  for (const line of resultContent.split(/\r?\n/)) {
    const match = /^A(\d+):\s?(.*)$/.exec(line.trim());
    if (match) {
      byOrdinal[Number(match[1]) - 1] = match[2];
    }
  }

  questions.forEach((question, index) => {
    const answer = byOrdinal[index];
    const questionText = readOptionalString(question?.question);
    if (answer !== undefined && questionText) {
      answers[questionText] = answer;
    }
  });
  return answers;
};
