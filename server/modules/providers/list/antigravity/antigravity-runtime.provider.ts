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
 * The two `step_type` values this runtime treats specially.
 *
 * `user_input` is suppressed (the client already renders its own bubble) and
 * `tool` becomes a tool card. Everything else — the documented
 * `agent_response`, the observed `system_message`, and anything a future
 * release adds — falls through to the generic text path rather than being
 * dropped.
 */
const AGY_USER_STEP_TYPES = new Set(['user_input']);

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
const buildAntigravityTokenBudget = (usage: unknown): {
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

/** Reads a `denied_actions` entry down to the two fields the UI shows. */
const describeDeniedAction = (entry: unknown): string => {
  const record = readObjectRecord(entry);
  if (!record) {
    return String(entry);
  }

  const displayName = readOptionalString(record.display_name);
  const action = readOptionalString(record.action);
  if (displayName && action) {
    return `${displayName} (${action})`;
  }
  return displayName || action || 'unknown action';
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

/**
 * Resolves the Antigravity project id the spawned CLI should be given.
 *
 * `--project` is what attributes a conversation *and* the only scope a
 * permission grant applies in (ADR 0015), so it is always passed. CloudCLI's
 * own project id is the identity that maps: it is stable per Project, and
 * resolving rather than creating is what lets a grant the user gave in the
 * Antigravity IDE itself apply to a run started here.
 */
const resolveAntigravityProjectId = (options: AnyRecord): string => {
  const explicitProject = readOptionalString(options.antigravityProjectId ?? options.projectId);
  if (explicitProject) {
    return explicitProject;
  }

  return readOptionalString(options.sessionId) || 'cloudcli-default';
};

/**
 * Maps the UI permission mode onto `agy`'s flags.
 *
 * Only two modes do anything headless: `--mode accept-edits` and `--mode plan`
 * are accepted and then ignored in print mode with a warning, so they are never
 * passed (ADR 0015). Default relies on the grants in the user's own project
 * record; bypassPermissions is the one escape hatch the CLI offers.
 */
const resolveAntigravityPermissionArgs = (permissionMode: unknown): string[] => (
  permissionMode === 'bypassPermissions' ? ['--dangerously-skip-permissions'] : []
);

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
  const resolvedModel = await context.resolveResumeModel(sessionId, model);

  return new Promise<void>((resolve, reject) => {
    const workingDir = cwd || projectPath || process.cwd();
    // Process-map key: the app session id when the caller supplied one, so
    // abort-by-app-id always works.
    const processKey = sessionId || Date.now().toString();
    let capturedSessionId = providerSessionId;
    let sessionCreatedSent = false;
    let stdoutLineBuffer = '';
    let stderrLineBuffer = '';
    // Unified lifecycle contract: exactly one terminal `complete` per run.
    let completeSent = false;
    let terminalNotificationSent = false;
    // Per-turn usage: the newest `step_update` usage, never `result.usage`.
    let latestStepUsage: unknown = null;

    const send = (message: NormalizedMessage): void => {
      ws.send(message);
    };

    const currentSessionId = (): string | null => capturedSessionId || sessionId || null;

    const notifyTerminalState = ({
      code = null,
      error = null,
    }: { code?: number | null; error?: unknown } = {}): void => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      // Notifications are app-facing, so they carry the app session id.
      const finalSessionId = sessionId || capturedSessionId || processKey;
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

    const registerSession = (nextSessionId: string | null): void => {
      if (!nextSessionId || capturedSessionId === nextSessionId) {
        return;
      }

      capturedSessionId = nextSessionId;
      const run = activeAntigravityProcesses.get(processKey);
      if (!sessionId && processKey !== capturedSessionId && run) {
        activeAntigravityProcesses.delete(processKey);
        activeAntigravityProcesses.set(capturedSessionId, run);
      }

      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(capturedSessionId);
      }

      if (!providerSessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: capturedSessionId,
          sessionId: capturedSessionId,
          provider: PROVIDER,
        }));
      }
    };

    /**
     * Handles one NDJSON line of `agy`'s stream-json output.
     *
     * `init` announces the conversation. `step_update` carries everything that
     * streams — assistant prose as `text_delta`, tool calls by name, and the
     * per-step `usage`. `result` ends the turn.
     */
    const processAntigravityEventLine = (line: string): void => {
      if (!line.trim()) {
        return;
      }

      let event: AnyRecord;
      try {
        const parsed = readObjectRecord(JSON.parse(line));
        if (!parsed) {
          return;
        }
        event = parsed;
      } catch {
        // Not NDJSON: surface it as streamed text rather than dropping it, so a
        // change in the CLI's output shape still reaches the user.
        send(createNormalizedMessage({
          kind: 'stream_delta',
          content: line,
          sessionId: currentSessionId(),
          provider: PROVIDER,
        }));
        return;
      }

      const eventName = readOptionalString(event.event);

      if (eventName === 'init') {
        const init = readObjectRecord(event.init);
        registerSession(
          (readOptionalString(event.conversation_id)
            ?? readOptionalString(init?.conversation_id)
            ?? null),
        );
        return;
      }

      if (eventName === 'step_update') {
        const update = readObjectRecord(event.step_update) as AgyStepUpdate | null;
        if (!update) {
          return;
        }

        registerSession(readOptionalString(update.conversation_id) ?? null);

        const stepType = readOptionalString(update.step_type) ?? '';
        const stepIndex = readOptionalString(update.step_index) ?? String(update.step_index ?? '');
        const state = readOptionalString(update.state);
        const sessionIdForEvent = currentSessionId();

        // Per-step usage is per-call, so this is the number the turn is billed
        // on.
        if (update.usage !== undefined) {
          latestStepUsage = update.usage;
        }

        // Tool calls: `tool` steps name the tool and carry `tool_info`. Unknown
        // step types fall through to the generic text path below rather than
        // being dropped.
        if (stepType === 'tool') {
          const toolName = readOptionalString(update.tool_name) ?? 'Tool';
          const toolInfo = readObjectRecord(update.tool_info);
          const toolMessage = createNormalizedMessage({
            // Keyed on step_index so ACTIVE and DONE emissions of the same step
            // update one card instead of stacking two.
            id: `antigravity-tool-${capturedSessionId || sessionId || 'run'}-${stepIndex}`,
            kind: 'tool_use',
            sessionId: sessionIdForEvent,
            provider: PROVIDER,
            toolName,
            toolInput: toolInfo ?? {},
            toolId: `antigravity-tool-${stepIndex}`,
          });

          // A completed tool step carries its result on the same record.
          if (state === 'DONE') {
            const output = readOptionalString(toolInfo?.output)
              ?? readOptionalString(toolInfo?.result)
              ?? readOptionalString(update.text_delta);
            if (output) {
              toolMessage.toolResult = { content: output };
            }
          }

          send(toolMessage);
          return;
        }

        // The user's own prompt is already rendered by the client's optimistic
        // bubble; echoing it back would double it.
        if (AGY_USER_STEP_TYPES.has(stepType)) {
          return;
        }

        const delta = typeof update.text_delta === 'string' ? update.text_delta : '';
        if (!delta) {
          return;
        }

        // Every other step type — the documented `agent_response`, the observed
        // `system_message`, and anything a future release adds — renders as text.
        send(createNormalizedMessage({
          kind: 'stream_delta',
          content: delta,
          sessionId: sessionIdForEvent,
          provider: PROVIDER,
          role: 'assistant',
        }));
        return;
      }

      if (eventName === 'result') {
        const result = readObjectRecord(event.result) as AgyResult | null;
        registerSession(
          (readOptionalString(event.conversation_id)
            ?? readOptionalString(result?.conversation_id)
            ?? null),
        );

        const deniedActions = Array.isArray(result?.denied_actions) ? result.denied_actions : [];
        const status = readOptionalString(result?.status);

        // `result.status` and the exit code cannot be trusted: a turn whose every
        // tool call was refused still reports SUCCESS and exits 0, with an empty
        // response. The refused-action list is the only signal.
        if (deniedActions.length > 0) {
          const described = deniedActions.map(describeDeniedAction).join(', ');
          send(createNormalizedMessage({
            kind: 'error',
            content: `Antigravity refused ${deniedActions.length === 1 ? 'this action' : 'these actions'}: ${described}. Grant it for this project, or rerun with permissions bypassed.`,
            sessionId: currentSessionId(),
            provider: PROVIDER,
          }));
        } else if (status && status !== 'SUCCESS' && status !== 'RUNNING') {
          send(createNormalizedMessage({
            kind: 'error',
            content: `Antigravity ended with status "${status}".`,
            sessionId: currentSessionId(),
            provider: PROVIDER,
          }));
        }

        if (latestStepUsage) {
          const tokenBudget = buildAntigravityTokenBudget(latestStepUsage);
          if (tokenBudget) {
            send(createNormalizedMessage({
              kind: 'status',
              text: 'token_budget',
              tokenBudget,
              sessionId: currentSessionId(),
              provider: PROVIDER,
            }));
          }
        }

        // Terminal complete, emitted here rather than on process close so the
        // UI stops waiting as soon as the turn reports.
        if (!completeSent) {
          completeSent = true;
          send(createCompleteMessage({
            provider: PROVIDER,
            sessionId: currentSessionId(),
            exitCode: 0,
          }));
        }
      }
    };

    const processAntigravityStderrLine = (line: string): void => {
      if (!line.trim()) {
        return;
      }

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
    args.push('--project', resolveAntigravityProjectId(options));
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
      const finalSessionId = sessionId || capturedSessionId || processKey;
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

      // Skipped for aborted runs, whose terminal `complete` (aborted: true) the
      // abort handler already sent.
      if (!completeSent && !run.aborted) {
        completeSent = true;
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
      const finalSessionId = sessionId || capturedSessionId || processKey;
      activeAntigravityProcesses.delete(finalSessionId);
      activeAntigravityProcesses.delete(processKey);

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
      if (!completeSent && !run.aborted) {
        completeSent = true;
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
