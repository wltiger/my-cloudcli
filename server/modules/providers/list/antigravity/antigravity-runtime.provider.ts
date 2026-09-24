/**
 * Antigravity (`agy`) CLI runtime
 * ===============================
 *
 * One `agy` process per turn, driven through its documented headless print mode
 * (`agy -p --output-format stream-json`) and resumed by conversation id. There
 * is no Node SDK — the official one is Python-only — so this is a subprocess
 * adapter in the same shape as the cursor and opencode runtimes.
 *
 * Usage:
 *   antigravityRuntime.run(command, options, writer, context)
 *   antigravityRuntime.abort(sessionId)
 *
 * The NDJSON event stream parsed here is documented in
 * `docs/agents/antigravity-provider-implementation.md` §3 and was observed on
 * `agy` 1.2.7.
 */

import type { ChildProcess } from 'node:child_process';

import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import {
  ANTIGRAVITY_ACTION_KINDS,
  ANTIGRAVITY_GRANT_RULE_PATTERN,
  resolveAntigravityProjectId,
} from '@/modules/providers/list/antigravity/antigravity-permissions.js';
import {
  buildAntigravityCompactBoundary,
  buildAntigravityMessageId,
  normalizeAntigravitySystemMessage,
} from '@/modules/providers/list/antigravity/antigravity-sessions.provider.js';
import {
  appendFilesInputTag,
  appendImagesInputTag,
  normalizeAttachmentDescriptors,
} from '@/shared/image-attachments.js';
import type {
  AnyRecord,
  NormalizedMessage,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import {
  AppError,
  createCompleteMessage,
  createNormalizedMessage,
  flattenPromptForWindowsShell,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const PROVIDER = 'antigravity';

/** Live `agy` processes keyed by the app session id, so abort-by-app-id works. */
const activeAntigravityProcesses = new Map<string, AntigravityRun>();

/**
 * A kill must not outlive this: on POSIX it is the SIGTERM -> SIGKILL
 * escalation window, on Windows the cap on `taskkill` itself.
 */
const AGY_KILL_ESCALATE_MS = 5_000;

/**
 * The `step_type` values this runtime treats specially.
 *
 * `user_input` is suppressed (the client already renders its own bubble),
 * `tool` becomes a tool card, `system_message` is buffered and routed like its
 * persisted record, and `checkpoint` (a compaction) becomes a divider.
 * Everything else — the documented `agent_response`, and anything a future
 * release adds — falls through to the generic text path rather than being
 * dropped.
 */
const AGY_USER_STEP_TYPES = new Set(['user_input']);
const AGY_SYSTEM_MESSAGE_STEP_TYPE = 'system_message';
const AGY_CHECKPOINT_STEP_TYPE = 'checkpoint';

/** Prefix `agy` puts on the structured error JSON it writes to stderr. */
const AGY_ERROR_PREFIX = 'AGY_ERROR:';

/** Shape of one entry in `result.denied_actions`. */
type AgyDeniedAction = {
  action?: string;
  display_name?: string;
};

/** One running turn, everything its stdout/stderr handlers and abort need. */
type AntigravityRun = {
  process: ChildProcess;
  /** Set by abort so the close handler does not emit a second `complete`. */
  aborted: boolean;
  kill: () => Promise<void>;
};

/** `step_update` values that reach the writer as assistant text. */
type AgyStepUpdate = {
  conversation_id?: string;
  step_index?: number | string;
  state?: string;
  step_type?: string;
  tool_name?: string;
  text_delta?: string;
  usage?: unknown;
  tool_info?: AnyRecord;
};

type AgyResult = {
  conversation_id?: string;
  status?: string;
  denied_actions?: AgyDeniedAction[];
};

const readUsageNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Builds the per-turn token budget from one `step_update`'s `usage`.
 *
 * Never from `result.usage`: on a resumed conversation that figure is
 * conversation-cumulative, so billing a turn from it charges the whole history
 * again on every follow-up. The per-step `usage` is the per-call number.
 */
export const buildAntigravityTokenBudget = (usage: unknown): {
  used: number;
  inputTokens: number;
  outputTokens: number;
  breakdown: { input: number; output: number };
} | null => {
  const record = readObjectRecord(usage);
  if (!record) {
    return null;
  }

  const inputTokens = readUsageNumber(record.input_tokens)
    + readUsageNumber(record.cache_read_tokens);
  const outputTokens = readUsageNumber(record.output_tokens);
  const used = readUsageNumber(record.total_tokens) || inputTokens + outputTokens;
  if (used <= 0) {
    return null;
  }

  return {
    used,
    inputTokens,
    outputTokens,
    breakdown: { input: inputTokens, output: outputTokens },
  };
};

/**
 * One refused action, paired with the rule that would permit it.
 *
 * `rule` is absent when the whole action could not be recovered: matching in
 * `agy` is exact, so a rule naming only the action kind would grant nothing,
 * and guessing the argument would write something the user did not ask for
 * into a record the IDE also owns. The notice still names the refusal; only
 * the one-click button needs the rule.
 */
type AntigravityRefusedAction = {
  action: string;
  displayName?: string;
  rule?: string;
};

/** Names one refused action in the sentence the error row shows. */
const describeDeniedAction = (entry: AntigravityRefusedAction): string => (
  entry.displayName && entry.displayName !== entry.action
    ? `${entry.displayName} (${entry.action})`
    : entry.action
);

/**
 * The same rule shape `ANTIGRAVITY_GRANT_RULE_PATTERN` matches, unanchored and
 * global so it can be scanned out of a whole stderr line. Derived from the
 * shared kind list rather than repeating it.
 */
const ANTIGRAVITY_GRANT_RULE_SCAN_PATTERN = new RegExp(
  `\\b(?:${ANTIGRAVITY_ACTION_KINDS.join('|')})\\([^)]+\\)`,
  'g',
);

/**
 * An argument that is only a placeholder, as in the `command(<target>)` the
 * refusal notice prints as an example of the *form* a rule takes.
 *
 * Anchored on the whole argument on purpose. A real rule may well contain an
 * angle bracket — `command(echo ok > out.txt)` is an ordinary redirection — so
 * rejecting every argument that merely *contains* one would throw away rules
 * the user does want.
 */
const ANTIGRAVITY_PLACEHOLDER_ARGUMENT_PATTERN = /^<[^>]*>$/;

/**
 * Pulls whole allow rules out of the refusal text `agy` writes to stderr.
 *
 * On 1.2.8 this yields nothing: the notice is boilerplate that spells out the
 * form of a rule (`… e.g. command(<target>)`) rather than naming the one that
 * was refused, and the example is filtered out here. The scan is kept because
 * the wording is not a contract — if a later release does name the real rule,
 * it is the only place the complete command/path/URL would appear, since the
 * `denied_actions` entry carries just the kind and a display name.
 */
export const collectGrantRuleCandidates = (line: string, into: Set<string>): void => {
  // `String.prototype.match` resets a global regex's `lastIndex`, so sharing
  // one module-level pattern across calls is safe.
  const matches = line.match(ANTIGRAVITY_GRANT_RULE_SCAN_PATTERN);
  for (const candidate of matches ?? []) {
    // Never offer a placeholder as a one-click grant: `command(<target>)`
    // matches nothing `agy` will ever run, and writing it into the project
    // record the Antigravity IDE also owns would be worse than no button.
    const argument = candidate.slice(candidate.indexOf('(') + 1, -1);
    if (ANTIGRAVITY_PLACEHOLDER_ARGUMENT_PATTERN.test(argument)) {
      continue;
    }

    into.add(candidate);
  }
};

/**
 * The command a tool step was about to run, from its `tool_info`.
 *
 * On 1.2.8 a tool call's arguments sit in a per-tool `parameters` object, and
 * `run_command` names its own `CommandLine`. The flat `command` is kept as a
 * second read in case that shape drifts. Only the `command` action kind has a
 * verified location like this; for `read_file`, `write_file` and the rest the
 * parameter name is still unobserved, so they keep the safe default of no rule
 * and therefore no button.
 */
const readAttemptedCommand = (toolInfo: AnyRecord | null): string | undefined => (
  readOptionalString(readObjectRecord(toolInfo?.parameters)?.CommandLine)
    ?? readOptionalString(toolInfo?.command)
);

/**
 * Turns one `denied_actions` entry into a refused action the UI can act on.
 *
 * Sources for the rule, in order of how much they are trusted: the entry's own
 * `action` when it already is a whole rule, the rule `agy` named on stderr for
 * the same kind, and finally the command of the tool call that was refused —
 * an observation of what was attempted, not a guess at what to allow. On 1.2.8
 * only the third fires: the entry carries a bare kind and stderr names no rule.
 */
export const buildRefusedAction = (
  entry: unknown,
  stderrRules: Set<string>,
  lastCommand: string | null,
): AntigravityRefusedAction => {
  const record = readObjectRecord(entry);
  const action = readOptionalString(record?.action) ?? 'unknown action';
  const displayName = readOptionalString(record?.display_name);

  if (ANTIGRAVITY_GRANT_RULE_PATTERN.test(action)) {
    return { action, displayName, rule: action };
  }

  for (const candidate of stderrRules) {
    if (candidate.startsWith(`${action}(`)) {
      // Consumed, so a turn that was refused twice over the same kind pairs
      // each refusal with its own rule instead of repeating the first.
      stderrRules.delete(candidate);
      return { action, displayName, rule: candidate };
    }
  }

  if (action === 'command' && lastCommand) {
    return { action, displayName, rule: `command(${lastCommand})` };
  }

  return { action, displayName };
};

/**
 * Everything one turn's NDJSON fold carries from one line to the next.
 *
 * Explicit rather than captured in the executor's closure, so the fold is a
 * module-level function that can be driven by synthetic events instead of only
 * by a live `agy` process.
 */
export type AntigravityTurnState = {
  /** The conversation id, once `agy` has announced one. */
  capturedSessionId: string | null;
  /** The newest `step_update` usage, never `result.usage` (see the budget builder). */
  latestStepUsage: unknown;
  /**
   * Whole allow rules `agy` named while refusing something this turn. Mutated
   * in place, because the stderr handler harvests into the same set.
   */
  refusalRuleCandidates: Set<string>;
  /** The last command a tool step tried to run, for the refusal notice. */
  lastAttemptedCommand: string | null;
  /** Unified lifecycle contract: exactly one terminal `complete` per run. */
  completeSent: boolean;
  /**
   * `system_message` text per step index, held until the step completes: the
   * envelope can only be routed once it is whole.
   */
  pendingSystemMessages: Record<string, string>;
  /** Whether a `stream_delta` has been sent that no `stream_end` has closed yet. */
  streamOpen: boolean;
};

/** The fold's collaborators: what it emits through, and who owns session adoption. */
export type AntigravityFoldContext = {
  /** The only side-effect channel. */
  send: (message: NormalizedMessage) => void;
  /**
   * Adopts a conversation id announced mid-stream and answers with the id the
   * turn is known by afterwards. Everything adoption touches outside the fold —
   * the process map, the writer's session id, the one-off `session_created` —
   * belongs to the caller.
   */
  registerSession: (capturedSessionId: string | null, nextSessionId: string | null) => string | null;
  /** The app session id, used until a conversation id has been seen. */
  appSessionId: string | null;
  /** Both only reach the refusal notice, which names the record a grant goes into. */
  antigravityProjectId: string;
  workspacePath: string;
  /** The prompt this turn ran, replayed when a granted action is retried. */
  prompt: string;
};

export const createAntigravityTurnState = (
  capturedSessionId: string | null = null,
): AntigravityTurnState => ({
  capturedSessionId,
  latestStepUsage: null,
  refusalRuleCandidates: new Set<string>(),
  lastAttemptedCommand: null,
  completeSent: false,
  pendingSystemMessages: {},
  streamOpen: false,
});

/** The session id every message of this turn is tagged with. */
const turnSessionId = (
  state: AntigravityTurnState,
  context: AntigravityFoldContext,
): string | null => state.capturedSessionId || context.appSessionId || null;

/**
 * Sends one buffered `system_message`, routed exactly as its persisted record is.
 *
 * An open assistant stream is closed first, so the client finalizes the prose
 * above this message instead of folding later prose into that bubble. The id
 * uses the app session id alone — never the conversation id — because it is
 * the only id the history reader also knows.
 */
const emitSystemMessage = (
  state: AntigravityTurnState,
  context: AntigravityFoldContext,
  stepIndex: string,
  content: string,
): AntigravityTurnState => {
  const message = normalizeAntigravitySystemMessage({
    content,
    id: buildAntigravityMessageId(context.appSessionId, stepIndex, 'system'),
    sessionId: turnSessionId(state, context),
  });
  if (!message) {
    return state;
  }

  if (state.streamOpen) {
    context.send(createNormalizedMessage({
      kind: 'stream_end',
      sessionId: turnSessionId(state, context),
      provider: PROVIDER,
    }));
  }
  context.send(message);
  return { ...state, streamOpen: false };
};

/**
 * Sends every `system_message` still buffered when the turn ends — on
 * `result`, or on process close/error for aborted and crashed runs — so an
 * interrupted turn does not swallow a notice.
 *
 * Returns the state with the buffer cleared; every caller reassigns it, which
 * is what makes a second call (close and error both fire on a spawn failure) a
 * no-op.
 */
export const flushAntigravityPendingMessages = (
  state: AntigravityTurnState,
  context: AntigravityFoldContext,
): AntigravityTurnState => {
  const pending = Object.entries(state.pendingSystemMessages)
    .sort(([left], [right]) => Number(left) - Number(right));
  if (pending.length === 0) {
    return state;
  }

  let next: AntigravityTurnState = { ...state, pendingSystemMessages: {} };
  for (const [stepIndex, content] of pending) {
    next = emitSystemMessage(next, context, stepIndex, content);
  }
  return next;
};

/** Hands a newly announced conversation id to the caller and folds the answer back in. */
const adoptSession = (
  state: AntigravityTurnState,
  context: AntigravityFoldContext,
  nextSessionId: string | null,
): AntigravityTurnState => {
  const capturedSessionId = context.registerSession(state.capturedSessionId, nextSessionId);
  return capturedSessionId === state.capturedSessionId
    ? state
    : { ...state, capturedSessionId };
};

/**
 * Folds one NDJSON line of `agy`'s stream-json output into the turn state.
 *
 * `init` announces the conversation. `step_update` carries everything that
 * streams — assistant prose as `text_delta`, tool calls by name, and the
 * per-step `usage`. `result` ends the turn.
 */
export const foldAntigravityEventLine = (
  state: AntigravityTurnState,
  line: string,
  context: AntigravityFoldContext,
): AntigravityTurnState => {
  if (!line.trim()) {
    return state;
  }

  let event: AnyRecord;
  try {
    const parsed = readObjectRecord(JSON.parse(line));
    if (!parsed) {
      return state;
    }
    event = parsed;
  } catch {
    // Not NDJSON: surface it as streamed text rather than dropping it, so a
    // change in the CLI's output shape still reaches the user.
    context.send(createNormalizedMessage({
      kind: 'stream_delta',
      content: line,
      sessionId: turnSessionId(state, context),
      provider: PROVIDER,
    }));
    return state.streamOpen ? state : { ...state, streamOpen: true };
  }

  const eventName = readOptionalString(event.event);

  if (eventName === 'init') {
    const init = readObjectRecord(event.init);
    return adoptSession(
      state,
      context,
      (readOptionalString(event.conversation_id)
        ?? readOptionalString(init?.conversation_id)
        ?? null),
    );
  }

  if (eventName === 'step_update') {
    const update = readObjectRecord(event.step_update) as AgyStepUpdate | null;
    if (!update) {
      return state;
    }

    let next = adoptSession(state, context, readOptionalString(update.conversation_id) ?? null);

    const stepType = readOptionalString(update.step_type) ?? '';
    const stepIndex = readOptionalString(update.step_index) ?? String(update.step_index ?? '');
    const stepState = readOptionalString(update.state);
    const sessionIdForEvent = turnSessionId(next, context);

    // Per-step usage is per-call, so this is the number the turn is billed
    // on.
    if (update.usage !== undefined) {
      next = { ...next, latestStepUsage: update.usage };
    }

    // Tool calls: `tool` steps name the tool and carry `tool_info`. Unknown
    // step types fall through to the generic text path below rather than
    // being dropped.
    if (stepType === 'tool') {
      const toolName = readOptionalString(update.tool_name) ?? 'Tool';
      const toolInfo = readObjectRecord(update.tool_info);
      // Kept for the refusal notice: a refused `command` action reports its
      // kind but not what it wanted to run, and on 1.2.8 nothing else does
      // either — this step is the only place the command text appears.
      next = {
        ...next,
        lastAttemptedCommand: readAttemptedCommand(toolInfo) ?? next.lastAttemptedCommand,
      };
      // Keyed on step_index so ACTIVE and DONE emissions of the same step
      // update one card instead of stacking two — and on the app session id
      // alone, so the card is pruned once its persisted twin (keyed on the
      // same step: the one that ran the call) arrives with history.
      const toolId = buildAntigravityMessageId(context.appSessionId, stepIndex, 'tool');
      const toolMessage = createNormalizedMessage({
        id: toolId,
        kind: 'tool_use',
        sessionId: sessionIdForEvent,
        provider: PROVIDER,
        toolName,
        toolInput: toolInfo ?? {},
        toolId,
      });

      // A completed tool step carries its result on the same record.
      if (stepState === 'DONE') {
        const output = readOptionalString(toolInfo?.output)
          ?? readOptionalString(toolInfo?.result)
          ?? readOptionalString(update.text_delta);
        if (output) {
          toolMessage.toolResult = { content: output };
        }
      }

      context.send(toolMessage);
      return next;
    }

    // The user's own prompt is already rendered by the client's optimistic
    // bubble; echoing it back would double it.
    if (AGY_USER_STEP_TYPES.has(stepType)) {
      return next;
    }

    const delta = typeof update.text_delta === 'string' ? update.text_delta : '';

    // A compaction: its text is the internal resume prompt, so only the
    // divider its persisted `CHECKPOINT` record also renders is shown.
    if (stepType === AGY_CHECKPOINT_STEP_TYPE) {
      if (stepState === 'DONE') {
        context.send(buildAntigravityCompactBoundary(context.appSessionId, stepIndex, sessionIdForEvent));
      }
      return next;
    }

    // Buffered, not streamed: the envelope decides whether this is a notice or
    // a sub-agent's report, and it is only whole once the step completes.
    if (stepType === AGY_SYSTEM_MESSAGE_STEP_TYPE) {
      const buffered = (next.pendingSystemMessages[stepIndex] ?? '') + delta;
      const { [stepIndex]: _buffered, ...otherPending } = next.pendingSystemMessages;
      if (stepState !== 'DONE') {
        return { ...next, pendingSystemMessages: { ...otherPending, [stepIndex]: buffered } };
      }

      return emitSystemMessage({ ...next, pendingSystemMessages: otherPending }, context, stepIndex, buffered);
    }

    if (!delta) {
      return next;
    }

    // Every other step type — the documented `agent_response`, and anything a
    // future release adds — renders as text.
    context.send(createNormalizedMessage({
      kind: 'stream_delta',
      content: delta,
      sessionId: sessionIdForEvent,
      provider: PROVIDER,
      role: 'assistant',
    }));
    return next.streamOpen ? next : { ...next, streamOpen: true };
  }

  if (eventName === 'result') {
    const result = readObjectRecord(event.result) as AgyResult | null;
    let next = adoptSession(
      state,
      context,
      (readOptionalString(event.conversation_id)
        ?? readOptionalString(result?.conversation_id)
        ?? null),
    );
    next = flushAntigravityPendingMessages(next, context);

    const deniedActions = Array.isArray(result?.denied_actions) ? result.denied_actions : [];
    const status = readOptionalString(result?.status);

    // `result.status` and the exit code cannot be trusted: a turn whose every
    // tool call was refused still reports SUCCESS and exits 0, with an empty
    // response. The refused-action list is the only signal.
    if (deniedActions.length > 0) {
      const refusedActions = deniedActions.map((entry) => (
        buildRefusedAction(entry, next.refusalRuleCandidates, next.lastAttemptedCommand)
      ));
      const described = refusedActions.map(describeDeniedAction).join(', ');
      context.send(createNormalizedMessage({
        kind: 'error',
        content: `Antigravity refused ${refusedActions.length === 1 ? 'this action' : 'these actions'}: ${described}. Grant it for this project, or rerun with permissions bypassed.`,
        sessionId: turnSessionId(next, context),
        provider: PROVIDER,
        // The post-turn notice: headless `agy` cannot prompt, so the
        // refusal is only actionable after the fact. Allowing a rule
        // re-runs this prompt as a new turn — the refused turn stays in
        // the transcript, because `agy` has no rewind (ADR 0014).
        antigravityRefusal: {
          projectId: context.antigravityProjectId,
          projectPath: context.workspacePath,
          prompt: context.prompt,
          actions: refusedActions,
        },
      }));
    } else if (status && status !== 'SUCCESS' && status !== 'RUNNING') {
      context.send(createNormalizedMessage({
        kind: 'error',
        content: `Antigravity ended with status "${status}".`,
        sessionId: turnSessionId(next, context),
        provider: PROVIDER,
      }));
    }

    if (next.latestStepUsage) {
      const tokenBudget = buildAntigravityTokenBudget(next.latestStepUsage);
      if (tokenBudget) {
        context.send(createNormalizedMessage({
          kind: 'status',
          text: 'token_budget',
          tokenBudget,
          sessionId: turnSessionId(next, context),
          provider: PROVIDER,
        }));
      }
    }

    // Terminal complete, emitted here rather than on process close so the
    // UI stops waiting as soon as the turn reports.
    if (!next.completeSent) {
      next = { ...next, completeSent: true };
      context.send(createCompleteMessage({
        provider: PROVIDER,
        sessionId: turnSessionId(next, context),
        exitCode: 0,
      }));
    }

    return next;
  }

  return state;
};

/**
 * Terminates a spawned `agy` process, tree and all.
 *
 * On Windows `agy` is reached through a shim, and killing that top-level
 * process leaves the real one underneath it orphaned, because Windows does not
 * cascade termination to children on its own. `taskkill /T` kills the whole
 * tree. POSIX has no such indirection, so a plain SIGTERM — escalating to
 * SIGKILL — already reaches the real process.
 */
function killAntigravityProcessTree(childProcess: ChildProcess): Promise<void> {
  if (!childProcess || !childProcess.pid) {
    return Promise.resolve();
  }

  if (process.platform !== 'win32') {
    return new Promise((resolve) => {
      const settle = () => {
        clearTimeout(forceKillTimer);
        resolve();
      };

      childProcess.once('exit', settle);
      childProcess.kill('SIGTERM');

      const forceKillTimer = setTimeout(() => {
        try {
          childProcess.kill('SIGKILL');
        } catch {
          // Already gone.
        }
        settle();
      }, AGY_KILL_ESCALATE_MS);
    });
  }

  return new Promise((resolve) => {
    const settle = () => {
      clearTimeout(killTimeoutHandle);
      resolve();
    };

    const killer = spawnFunction('taskkill', ['/pid', String(childProcess.pid), '/T', '/F'], { stdio: 'ignore' });
    killer.on('close', settle);
    killer.on('error', settle);

    // `taskkill` is itself a subprocess; without this a hung one would leave
    // the awaiting side pending forever.
    const killTimeoutHandle = setTimeout(settle, AGY_KILL_ESCALATE_MS);
  });
}

/** The only two permission modes the capability matrix offers for this provider. */
const ANTIGRAVITY_PERMISSION_MODES = ['default', 'bypassPermissions'] as const;

/**
 * Maps the UI permission mode onto `agy`'s flags.
 *
 * Only two modes do anything headless: `--mode accept-edits` and `--mode plan`
 * are accepted and then ignored in print mode with a warning, so they are never
 * passed (ADR 0015). Default relies on the grants in the user's own project
 * record; bypassPermissions is the one escape hatch the CLI offers.
 *
 * Anything outside those two is rejected instead of quietly resolving to
 * default. The two modes differ by *less* versus *more* permission, so a typo
 * treated as default would hand the run fewer grants than the caller asked for
 * and look like the CLI refusing on its own. An omitted mode is still default:
 * that is a caller not choosing, not a caller choosing wrong.
 */
export const resolveAntigravityPermissionArgs = (permissionMode: unknown): string[] => {
  if (permissionMode === undefined || permissionMode === null) {
    return [];
  }

  if (!(ANTIGRAVITY_PERMISSION_MODES as readonly unknown[]).includes(permissionMode)) {
    throw new AppError(
      `Unsupported permissionMode "${String(permissionMode)}" for antigravity. Supported modes: ${ANTIGRAVITY_PERMISSION_MODES.join(', ')}.`,
      { code: 'INVALID_PERMISSION_MODE', statusCode: 400 },
    );
  }

  return permissionMode === 'bypassPermissions' ? ['--dangerously-skip-permissions'] : [];
};

/**
 * Assembles the whole `agy` command line for one turn.
 *
 * Always present: `-p` (headless print mode), `--output-format stream-json`
 * (the NDJSON the fold reads) and `--project` (see below). Everything else is
 * conditional, and each condition matters: `--conversation` turns the run into
 * a resume, `--model` overrides whatever the CLI would have picked, and the
 * permission flag hands the turn more permission than the project record grants.
 * Passing any of them when they do not apply would change what the turn does.
 */
export const buildAntigravityArgs = ({
  command,
  projectPath,
  images,
  files,
  antigravityProjectId,
  providerSessionId,
  resolvedModel,
  permissionMode,
}: {
  command: string;
  projectPath?: string | null;
  images?: unknown;
  files?: unknown;
  antigravityProjectId: string;
  providerSessionId?: string | null;
  resolvedModel?: string | null;
  permissionMode?: unknown;
}): string[] => {
  const args = ['-p'];
  const hasAttachments =
    normalizeAttachmentDescriptors(images).length > 0
    || normalizeAttachmentDescriptors(files).length > 0;

  if ((command && command.trim()) || hasAttachments) {
    // Image and file attachments ride along as `<images_input>`/`<files_input>`
    // path lists appended to the prompt: stream-json input accepts `text`
    // blocks only, so there is no native attachment block to use. The prompt
    // must be newline-free on Windows, where a shim hands it to cmd.exe.
    args.push(flattenPromptForWindowsShell(
      appendFilesInputTag(appendImagesInputTag(command?.trim() || '', images), files),
    ));
  }

  args.push('--output-format', 'stream-json');
  // Ground rule: `--project` attributes the conversation and is the only scope
  // a permission grant applies in; `--add-dir` adds the workspace root so the
  // session index can attribute it too. Both, always.
  args.push('--project', antigravityProjectId);
  if (projectPath) {
    args.push('--add-dir', projectPath);
  }
  if (providerSessionId) {
    args.push('--conversation', providerSessionId);
  }
  if (resolvedModel) {
    args.push('--model', resolvedModel);
  }
  args.push(...resolveAntigravityPermissionArgs(permissionMode));

  return args;
};

/**
 * Runs one Antigravity turn and streams it to the writer.
 */
async function spawnAntigravity(
  command: string,
  options: AnyRecord = {},
  ws: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
): Promise<void> {
  const {
    sessionId,
    projectPath,
    cwd,
    model,
    sessionSummary,
    images,
    files,
    permissionMode,
  } = options;

  // Callers pass the stable app session id; the CLI resumes with the
  // provider-native conversation id recorded on the session row. Resolved
  // before the promise is created: inside an async executor a rejection here
  // would be swallowed and leave the returned promise pending forever.
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  // Rejected here for the same reason: a bad mode is caller input, and failing
  // before the process exists — before `resolveAntigravityProjectId` below can
  // create a project record for it — keeps it a 400 instead of a half-started
  // turn. `buildAntigravityArgs` derives the flags from the same helper.
  resolveAntigravityPermissionArgs(permissionMode);
  const resolvedModel = await context.resolveResumeModel(sessionId, model);
  // The Antigravity project whose folder covers this Project — the user's own
  // record, so a grant given in the Antigravity IDE applies here too (ADR
  // 0015). Recomputed every run and never stored: the records are the IDE's to
  // move and rename. One is created only when nothing covers the path.
  const workspacePath = readOptionalString(projectPath) ?? readOptionalString(cwd) ?? process.cwd();
  const antigravityProjectId = await resolveAntigravityProjectId(workspacePath);

  return new Promise<void>((resolve, reject) => {
    const workingDir = cwd || projectPath || process.cwd();
    // Process-map key: the app session id when the caller supplied one, so
    // abort-by-app-id always works.
    const processKey = sessionId || Date.now().toString();
    let sessionCreatedSent = false;
    let stdoutLineBuffer = '';
    let stderrLineBuffer = '';
    let terminalNotificationSent = false;
    // Everything the fold carries across lines — the conversation id, the
    // per-turn usage, the refusal material and the one-terminal-complete flag.
    let turnState = createAntigravityTurnState(providerSessionId);

    const send = (message: NormalizedMessage): void => {
      ws.send(message);
    };

    const currentSessionId = (): string | null => turnState.capturedSessionId || sessionId || null;

    const notifyTerminalState = ({
      code = null,
      error = null,
    }: { code?: number | null; error?: unknown } = {}): void => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      // Notifications are app-facing, so they carry the app session id.
      const finalSessionId = sessionId || turnState.capturedSessionId || processKey;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: PROVIDER,
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: PROVIDER,
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        error: error || `Antigravity CLI exited with code ${code}`,
      });
    };

    /**
     * Adopts a conversation id the CLI announced mid-stream.
     *
     * Everything adoption touches lives out here rather than in the fold: the
     * process map (so abort keeps working after the key changes), the writer's
     * session id, and the one-off `session_created` a brand-new conversation
     * owes the client.
     */
    const registerSession = (
      capturedSessionId: string | null,
      nextSessionId: string | null,
    ): string | null => {
      if (!nextSessionId || capturedSessionId === nextSessionId) {
        return capturedSessionId;
      }

      const run = activeAntigravityProcesses.get(processKey);
      if (!sessionId && processKey !== nextSessionId && run) {
        activeAntigravityProcesses.delete(processKey);
        activeAntigravityProcesses.set(nextSessionId, run);
      }

      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(nextSessionId);
      }

      if (!providerSessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: nextSessionId,
          sessionId: nextSessionId,
          provider: PROVIDER,
        }));
      }

      return nextSessionId;
    };

    const foldContext: AntigravityFoldContext = {
      send,
      registerSession,
      appSessionId: sessionId || null,
      antigravityProjectId,
      workspacePath,
      prompt: command,
    };

    const processAntigravityEventLine = (line: string): void => {
      turnState = foldAntigravityEventLine(turnState, line, foldContext);
    };

    const processAntigravityStderrLine = (line: string): void => {
      if (!line.trim()) {
        return;
      }

      // A refusal notice names the rule that would have allowed the action.
      // Harvested from every stderr line because the notice is not structured
      // and its wording is not a contract.
      collectGrantRuleCandidates(line, turnState.refusalRuleCandidates);

      // `agy` reports structured failures as `AGY_ERROR: {json}` on stderr;
      // everything else is ordinary CLI chatter.
      const errorIndex = line.indexOf(AGY_ERROR_PREFIX);
      if (errorIndex !== -1) {
        const payload = line.slice(errorIndex + AGY_ERROR_PREFIX.length).trim();
        const record = readObjectRecord((() => {
          try {
            return JSON.parse(payload);
          } catch {
            return null;
          }
        })());

        const message = record
          ? readOptionalString(record.message)
            ?? readOptionalString(record.error)
            ?? readOptionalString(record.status)
          : undefined;

        send(createNormalizedMessage({
          kind: 'error',
          content: message ? `Antigravity: ${message}` : `Antigravity: ${payload.slice(0, 500)}`,
          sessionId: currentSessionId(),
          provider: PROVIDER,
        }));
        return;
      }

      send(createNormalizedMessage({
        kind: 'error',
        content: line,
        sessionId: currentSessionId(),
        provider: PROVIDER,
      }));
    };

    const args = buildAntigravityArgs({
      command,
      projectPath,
      images,
      files,
      antigravityProjectId,
      providerSessionId,
      resolvedModel,
      permissionMode,
    });

    let agyProcess;
    try {
      agyProcess = spawnFunction('agy', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Auto-update is disabled for this child only — never for CloudCLI's own
        // process, so the user's terminal `agy` keeps updating.
        env: { ...process.env, AGY_CLI_DISABLE_AUTO_UPDATE: '1' },
      });
    } catch (error) {
      const errorContent = error instanceof Error ? error.message : String(error);
      send(createNormalizedMessage({
        kind: 'error',
        content: `Antigravity CLI could not be started: ${errorContent}`,
        sessionId: sessionId || null,
        provider: PROVIDER,
      }));
      send(createCompleteMessage({ provider: PROVIDER, sessionId: sessionId || null, exitCode: 1 }));
      notifyTerminalState({ error: errorContent });
      reject(error instanceof Error ? error : new Error(errorContent));
      return;
    }

    const run: AntigravityRun = {
      process: agyProcess,
      aborted: false,
      kill: () => killAntigravityProcessTree(agyProcess),
    };
    activeAntigravityProcesses.set(processKey, run);

    const { stdin, stdout, stderr } = agyProcess;

    // No stdin driver loop: one process per turn, so stdin is closed
    // immediately and the CLI winds down on its own.
    stdin?.end();

    stdout?.on('data', (data) => {
      stdoutLineBuffer += data.toString();
      const completeLines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = completeLines.pop() || '';

      for (const line of completeLines) {
        processAntigravityEventLine(line.trim());
      }
    });

    stderr?.on('data', (data) => {
      stderrLineBuffer += data.toString();
      const completeLines = stderrLineBuffer.split(/\r?\n/);
      stderrLineBuffer = completeLines.pop() || '';

      for (const line of completeLines) {
        processAntigravityStderrLine(line.trim());
      }
    });

    agyProcess.on('close', async (code) => {
      const finalSessionId = sessionId || turnState.capturedSessionId || processKey;
      activeAntigravityProcesses.delete(finalSessionId);
      activeAntigravityProcesses.delete(processKey);

      if (stdoutLineBuffer.trim()) {
        processAntigravityEventLine(stdoutLineBuffer.trim());
        stdoutLineBuffer = '';
      }
      if (stderrLineBuffer.trim()) {
        processAntigravityStderrLine(stderrLineBuffer.trim());
        stderrLineBuffer = '';
      }
      // A turn that ended without `result` (aborted, crashed) still shows the
      // system message it was in the middle of.
      turnState = flushAntigravityPendingMessages(turnState, foldContext);

      // Skipped for aborted runs, whose terminal `complete` (aborted: true) the
      // abort handler already sent.
      if (!turnState.completeSent && !run.aborted) {
        turnState = { ...turnState, completeSent: true };
        send(createCompleteMessage({ provider: PROVIDER, sessionId: finalSessionId, exitCode: code ?? 1 }));
      }

      if (code === 0) {
        notifyTerminalState({ code });
        resolve();
        return;
      }

      if (code === 127 || code === null) {
        const installed = await context.isProviderInstalled();
        if (!installed) {
          send(createNormalizedMessage({
            kind: 'error',
            content: 'Antigravity CLI is not installed. Install it from https://antigravity.google',
            sessionId: finalSessionId,
            provider: PROVIDER,
          }));
        }
      }

      notifyTerminalState({ code });
      reject(new Error(code === null ? 'Antigravity CLI process was terminated' : `Antigravity CLI exited with code ${code}`));
    });

    agyProcess.on('error', async (error) => {
      const finalSessionId = sessionId || turnState.capturedSessionId || processKey;
      activeAntigravityProcesses.delete(finalSessionId);
      activeAntigravityProcesses.delete(processKey);
      turnState = flushAntigravityPendingMessages(turnState, foldContext);

      const installed = await context.isProviderInstalled();
      const errorContent = !installed
        ? 'Antigravity CLI is not installed. Install it from https://antigravity.google'
        : error.message;

      send(createNormalizedMessage({
        kind: 'error',
        content: errorContent,
        sessionId: finalSessionId,
        provider: PROVIDER,
      }));
      if (!turnState.completeSent && !run.aborted) {
        turnState = { ...turnState, completeSent: true };
        send(createCompleteMessage({ provider: PROVIDER, sessionId: finalSessionId, exitCode: 1 }));
      }
      notifyTerminalState({ error });
      reject(error);
    });
  });
}

/**
 * Aborts one running turn by killing its process tree.
 *
 * There is no `agy cancel` subcommand; killing the child is the mechanism, and
 * the conversation itself stays resumable because resume only needs the
 * conversation id.
 */
function abortAntigravitySession(sessionId: string): boolean {
  const run = activeAntigravityProcesses.get(sessionId);
  if (!run) {
    return false;
  }

  // Flagged so the close handler does not emit a second terminal `complete`.
  run.aborted = true;
  activeAntigravityProcesses.delete(sessionId);
  void run.kill();
  return true;
}

/** Used by the providers module's AntigravityProvider to run and abort turns. */
export const antigravityRuntime = {
  run: spawnAntigravity,
  abort: abortAntigravitySession,
};
