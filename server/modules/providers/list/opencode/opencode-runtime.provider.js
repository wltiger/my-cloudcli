import fsSync from 'node:fs';

import crossSpawn from 'cross-spawn';
import Database from 'better-sqlite3';

import {
  appendFilesInputTag,
  appendImagesInputTag,
  normalizeAttachmentDescriptors
} from '@/shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell, getOpenCodeDatabasePath } from '@/shared/utils.js';

import { withOpenCodeServe } from './opencode-serve.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const activeOpenCodeProcesses = new Map();

/**
 * Maps the UI permission mode onto OpenCode's non-interactive controls.
 *
 * OpenCode has no single "permission mode" flag; each mode uses a different
 * lever of the `opencode run` CLI (verified against v1.17.13):
 * - plan              → the built-in read-only `plan` agent (`--agent plan`).
 * - bypassPermissions → `--auto`, which auto-approves every permission that
 *                       is not explicitly denied in the user's config.
 * - acceptEdits       → the OPENCODE_PERMISSION env var, whose JSON body the
 *                       CLI merges into its permission config. Forcing
 *                       `edit: allow` guarantees file edits go through while
 *                       every other rule stays under the user's own config.
 * - default           → nothing; the user's opencode.json governs. In
 *                       non-interactive `run` mode any `ask` rule is denied.
 *
 * Exported for tests only.
 */
export function resolveOpenCodePermissionOptions(permissionMode) {
  switch (permissionMode) {
    case 'plan':
      return { args: ['--agent', 'plan'], env: {} };
    case 'bypassPermissions':
      return { args: ['--auto'], env: {} };
    case 'acceptEdits':
      return { args: [], env: { OPENCODE_PERMISSION: JSON.stringify({ edit: 'allow' }) } };
    default:
      return { args: [], env: {} };
  }
}

function resolveOpenCodeEffort(model, effort, modelsDefinition) {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model);
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
}

function readOpenCodeSessionId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  return event.sessionID || event.sessionId || null;
}

function readOpenCodeTokenUsage(sessionId) {
  const dbPath = getOpenCodeDatabasePath();
  if (!sessionId || !fsSync.existsSync(dbPath)) {
    return null;
  }

  let db = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const columns = db.prepare('PRAGMA table_info(session)').all();
    const columnNames = new Set(columns.map((column) => column.name));
    const requiredColumns = ['tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write'];
    if (!requiredColumns.every((column) => columnNames.has(column))) {
      return null;
    }

    const row = db.prepare(`
      SELECT
        tokens_input AS inputTokens,
        tokens_output AS outputTokens,
        tokens_reasoning AS reasoningTokens,
        tokens_cache_read AS cacheReadTokens,
        tokens_cache_write AS cacheWriteTokens
      FROM session
      WHERE id = ?
    `).get(sessionId);

    if (!row) {
      return null;
    }

    const inputTokens = Number(row.inputTokens || 0) + Number(row.cacheReadTokens || 0);
    const outputTokens = Number(row.outputTokens || 0);
    const used = Number(row.inputTokens || 0)
      + outputTokens
      + Number(row.reasoningTokens || 0)
      + Number(row.cacheReadTokens || 0)
      + Number(row.cacheWriteTokens || 0);
    if (used <= 0) {
      return null;
    }

    return {
      used,
      inputTokens,
      outputTokens,
      breakdown: {
        input: inputTokens,
        output: outputTokens,
      },
    };
  } catch {
    return null;
  } finally {
    if (db) {
      db.close();
    }
  }
}

const OPENCODE_COMPACT_COMMAND = '/compact';
// Startup is normally near-instant; this only guards against a hung CLI.
const OPENCODE_SERVE_READY_TIMEOUT_MS = 15_000;
// Compaction summarizes the whole context, so it can run well past a typical
// request (issue #18 measured ~20s on a real session).
const OPENCODE_COMPACT_REQUEST_TIMEOUT_MS = 120_000;
// A kill must not outlive this: on POSIX it is the SIGTERM -> SIGKILL
// escalation window, on Windows the cap on `taskkill` itself.
const OPENCODE_KILL_ESCALATE_MS = 5_000;
const OPENCODE_SERVE_LISTENING_PATTERN = /listening on http:\/\/([^\s/:]+):(\d+)/i;

/**
 * OpenCode's `run` CLI does not expand slash commands — the positional
 * message reaches the model as plain text (verified against 1.18.18) — so
 * `/compact` must be intercepted before it is ever handed to `opencode run`.
 * Exported for tests only.
 */
export function isOpenCodeCompactCommand(command) {
  return typeof command === 'string' && command.trim() === OPENCODE_COMPACT_COMMAND;
}

/**
 * Splits a resolved `<providerID>/<modelID>` model id into the two halves
 * OpenCode's summarize endpoint body needs separately. Returns null when the
 * value is missing or not in that shape.
 * Exported for tests only.
 */
export function splitOpenCodeModelId(resolvedModel) {
  if (typeof resolvedModel !== 'string') {
    return null;
  }

  const slashIndex = resolvedModel.indexOf('/');
  if (slashIndex <= 0 || slashIndex === resolvedModel.length - 1) {
    return null;
  }

  return {
    providerID: resolvedModel.slice(0, slashIndex),
    modelID: resolvedModel.slice(slashIndex + 1),
  };
}

/**
 * Terminates a spawned OpenCode process, tree and all.
 *
 * cross-spawn resolves `opencode` to its Windows `.cmd` shim, which Windows
 * can only execute through an intermediary `cmd.exe`. Killing that top-level
 * process leaves the real `node`/`bun` process underneath it — and the port
 * it holds — orphaned, because Windows does not cascade termination to
 * children on its own (verified against this exact spawn chain: a plain
 * `.kill('SIGTERM')` left the ephemeral server's port still listening).
 * `taskkill /T` kills the whole tree. POSIX has no such indirection, so a
 * plain SIGTERM already reaches the real process there.
 *
 * Exported for `opencode-serve.ts`, whose `withOpenCodeServe` is the one place
 * the start/use/shut-down bracket around a headless server is written.
 */
export function killOpenCodeProcessTree(childProcess) {
  if (!childProcess || !childProcess.pid) {
    return Promise.resolve();
  }

  if (process.platform !== 'win32') {
    // Same escalation the plugin module uses (`stopPluginServer`): ask politely,
    // then force it, so a server that ignores SIGTERM cannot keep its port.
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
      }, OPENCODE_KILL_ESCALATE_MS);
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
    // the awaiting side channel pending forever.
    const killTimeoutHandle = setTimeout(settle, OPENCODE_KILL_ESCALATE_MS);
  });
}

/**
 * Starts a short-lived headless `opencode serve` on an OS-assigned ephemeral
 * port (`--port 0`) and resolves once its own stdout confirms it is
 * listening — that line is only printed once the socket is already accepting
 * connections, so no separate readiness poll is needed. OpenCode's session
 * storage is global (verified in #18/#21), so this instance can address any
 * session regardless of which directory it starts in.
 *
 * Any failure to reach "listening" (spawn error, early exit, timeout) kills
 * the process itself before rejecting, so a caller never has to clean up a
 * process it was never handed.
 *
 * Exported for `opencode-serve.ts`, whose `withOpenCodeServe` pairs it with
 * `killOpenCodeProcessTree` for every Fork and revert call.
 */
export function startOpenCodeServeProcess(cwd) {
  return new Promise((resolve, reject) => {
    const serveProcess = spawnFunction('opencode', ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    function settleResolve(baseUrl) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve({ process: serveProcess, baseUrl });
    }

    function settleReject(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      void killOpenCodeProcessTree(serveProcess).finally(() => reject(error));
    }

    const timeoutHandle = setTimeout(() => {
      settleReject(new Error('Timed out waiting for the OpenCode server to start.'));
    }, OPENCODE_SERVE_READY_TIMEOUT_MS);

    serveProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const match = stdoutBuffer.match(OPENCODE_SERVE_LISTENING_PATTERN);
      if (match) {
        settleResolve(`http://${match[1]}:${match[2]}`);
      }
    });

    serveProcess.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });

    serveProcess.on('error', (error) => {
      settleReject(error);
    });

    serveProcess.on('close', (code) => {
      settleReject(new Error(
        stderrBuffer.trim()
          ? `OpenCode server exited with code ${code} before it started listening: ${stderrBuffer.trim()}`
          : `OpenCode server exited with code ${code} before it started listening.`
      ));
    });
  });
}

/**
 * Runs OpenCode's Compact through its HTTP server API, the only place it is
 * reachable — the one-shot `run` CLI has no equivalent (verified in #18/#21).
 * Starts a short-lived headless server, posts to the legacy `/summarize`
 * route with the resolved provider/model, and always shuts the server down
 * before returning, on every path including failure.
 */
async function runOpenCodeCompactSideChannel(options, ws, context) {
  const { sessionId, projectPath, cwd, model } = options;
  const workingDir = cwd || projectPath || process.cwd();

  const sendError = (content) => {
    ws.send(createNormalizedMessage({
      kind: 'error',
      content,
      sessionId: sessionId || null,
      provider: 'opencode',
    }));
  };

  let completeSent = false;
  const finish = (success, { aborted = false } = {}) => {
    if (completeSent) {
      return;
    }
    completeSent = true;
    ws.send(createCompleteMessage({
      provider: 'opencode',
      sessionId: sessionId || null,
      exitCode: success ? 0 : 1,
      ...(aborted ? { aborted: true } : {}),
    }));
  };

  const providerSessionId = context.resolveProviderSessionId(sessionId);
  if (!providerSessionId) {
    sendError('Nothing to compact yet — start a conversation first.');
    finish(false);
    return;
  }

  const resolvedModel = await context.resolveResumeModel(sessionId, model);
  const modelIds = splitOpenCodeModelId(resolvedModel);
  if (!modelIds) {
    sendError('OpenCode Compact could not determine a provider/model to summarize with.');
    finish(false);
    return;
  }

  // Registered under the same key as a normal run so Stop reaches the side
  // channel too; without this `abortOpenCodeSession` reports nothing running
  // and the ephemeral server keeps its port until the request times out.
  let serveHandle;
  const compactHandle = {
    aborted: false,
    kill: () => {
      void killOpenCodeProcessTree(serveHandle?.process);
    },
  };
  activeOpenCodeProcesses.set(sessionId, compactHandle);

  const notifyTerminalState = (error) => {
    const notifyPayload = {
      userId: ws?.userId || null,
      provider: 'opencode',
      sessionId: sessionId || null,
      sessionName: options.sessionSummary,
    };
    if (error) {
      notifyRunFailed({ ...notifyPayload, error });
      return;
    }
    notifyRunStopped({ ...notifyPayload, stopReason: 'completed' });
  };

  // Tells a server that never started apart from a request that failed: both
  // leave withOpenCodeServe as a throw, and the reader is told which happened.
  let serveStarted = false;

  try {
    await withOpenCodeServe(workingDir, async (handle) => {
      serveHandle = handle;
      serveStarted = true;

      const response = await fetch(
        `${serveHandle.baseUrl}/session/${encodeURIComponent(providerSessionId)}/summarize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerID: modelIds.providerID, modelID: modelIds.modelID }),
          signal: AbortSignal.timeout(OPENCODE_COMPACT_REQUEST_TIMEOUT_MS),
        }
      );

      const responseText = await response.text();
      let parsedBody;
      try {
        parsedBody = JSON.parse(responseText);
      } catch {
        parsedBody = undefined;
      }

      // The published `/api/session/{id}/compact` is unimplemented (503) and
      // `/api/session/{id}/summarize` is not a route at all — it falls through
      // to the web UI's HTML catch-all and answers 200 with an HTML body. Only
      // the legacy unprefixed route works, so the body — not just the status —
      // has to confirm the summarize call actually ran. See #18/#21.
      if (!response.ok || parsedBody !== true) {
        sendError(`OpenCode Compact failed (HTTP ${response.status}).`);
        notifyTerminalState(`OpenCode Compact failed (HTTP ${response.status}).`);
        finish(false);
        return;
      }

      notifyTerminalState(null);
      finish(true);
    });
  } catch (error) {
    const errorContent = error instanceof Error ? error.message : String(error);
    if (!serveStarted) {
      console.error('[OpenCode] Compact failed to start the headless server:', errorContent);
      if (!compactHandle.aborted) {
        sendError(`OpenCode Compact could not start: ${errorContent}`);
        notifyTerminalState(errorContent);
      }
      finish(false, { aborted: compactHandle.aborted });
    } else {
      console.error('[OpenCode] Compact request failed:', errorContent);
      // An abort tears the server down mid-request, so the resulting fetch
      // failure is expected rather than something to report as a failure.
      if (compactHandle.aborted) {
        finish(false, { aborted: true });
      } else {
        sendError(`OpenCode Compact failed: ${errorContent}`);
        notifyTerminalState(errorContent);
        finish(false);
      }
    }
  } finally {
    activeOpenCodeProcesses.delete(sessionId);
  }
}

async function spawnOpenCode(command, options = {}, ws, context) {
  // `/compact` never reaches `opencode run` — see runOpenCodeCompactSideChannel.
  if (isOpenCodeCompactCommand(command)) {
    return runOpenCodeCompactSideChannel(options, ws, context);
  }

  return new Promise((resolve, reject) => {
    const {
      sessionId,
      projectPath,
      cwd,
      model,
      effort,
      sessionSummary,
      images,
      files,
      permissionMode
    } = options;
    // Callers pass the stable app session id; the CLI resumes with the
    // provider-native id recorded on the session row.
    const providerSessionId = context.resolveProviderSessionId(sessionId);
    const workingDir = cwd || projectPath || process.cwd();
    // Process-map key: the app session id when the caller supplied one, so
    // abort-by-app-id always works.
    const processKey = sessionId || Date.now().toString();
    let capturedSessionId = providerSessionId;
    let sessionCreatedSent = false;
    let stdoutLineBuffer = '';
    let terminalNotificationSent = false;
    let opencodeProcess = null;
    // Unified lifecycle contract: exactly one terminal `complete` per run
    // (close and error handlers can both fire for spawn failures).
    let completeSent = false;

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      // Notifications are app-facing, so they carry the app session id.
      const finalSessionId = sessionId || capturedSessionId || processKey;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'opencode',
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'opencode',
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        error: error || `OpenCode CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId) => {
      if (!nextSessionId || capturedSessionId === nextSessionId) {
        return;
      }

      capturedSessionId = nextSessionId;
      // Legacy/direct callers without an app session id re-key the process
      // under the provider-native id once it is known.
      if (!sessionId && processKey !== capturedSessionId && opencodeProcess) {
        activeOpenCodeProcesses.delete(processKey);
        activeOpenCodeProcesses.set(capturedSessionId, opencodeProcess);
      }
      if (opencodeProcess) {
        opencodeProcess.sessionId = capturedSessionId;
      }

      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(capturedSessionId);
      }

      if (!providerSessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        ws.send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: capturedSessionId,
          sessionId: capturedSessionId,
          provider: 'opencode',
        }));
      }
    };

    const processOpenCodeOutputLine = (line) => {
      if (!line || !line.trim()) {
        return;
      }

      let response;
      try {
        response = JSON.parse(line);
      } catch {
        ws.send(createNormalizedMessage({
          kind: 'stream_delta',
          content: line,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'opencode',
        }));
        return;
      }

      try {
        registerSession(readOpenCodeSessionId(response));
        const normalized = context.normalizeMessage(response, capturedSessionId || sessionId || null);
        for (const msg of normalized) {
          ws.send(msg);
        }
      } catch (error) {
        const errorContent = error instanceof Error ? error.message : String(error);
        console.error('[OpenCode] Failed to process JSON output:', errorContent);
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'opencode',
        }));
      }
    };

    void context.resolveResumeModel(sessionId, model).then(async (resolvedModel) => {
      let effortModels = null;
      try {
        effortModels = await context.getProviderModels();
      } catch (error) {
        console.warn('[OpenCode] Unable to load provider models for effort validation:', error);
      }

      const resolvedEffort = resolveOpenCodeEffort(resolvedModel, effort, effortModels);
      const args = ['run', '--format', 'json'];
      // OpenCode's `run` command owns workspace selection through `--dir`.
      // Relying on the child-process cwd alone is not enough on Linux, where
      // the CLI can still resolve the session under the server install dir.
      args.push('--dir', workingDir);
      if (providerSessionId) {
        args.push('--session', providerSessionId);
      }
      if (resolvedModel) {
        args.push('--model', resolvedModel);
      }
      if (resolvedEffort) {
        args.push('--variant', resolvedEffort);
      }
      const permissionOptions = resolveOpenCodePermissionOptions(permissionMode);
      args.push(...permissionOptions.args);
      const hasAttachments =
        normalizeAttachmentDescriptors(images).length > 0
        || normalizeAttachmentDescriptors(files).length > 0;
      if ((command && command.trim()) || hasAttachments) {
        // Image attachments ride along as an <images_input> path list appended
        // to the prompt; the session history reader strips the tag back out.
        // opencode is a .cmd shim on Windows, so the whole argument must be
        // newline-free or cmd.exe silently truncates it at the first newline.
        const promptWithAttachments = appendFilesInputTag(
          appendImagesInputTag(command?.trim() || '', images),
          files
        );
        args.push(flattenPromptForWindowsShell(promptWithAttachments));
      }

      opencodeProcess = spawnFunction('opencode', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...permissionOptions.env },
      });

      activeOpenCodeProcesses.set(processKey, opencodeProcess);
      opencodeProcess.sessionId = processKey;
      opencodeProcess.stdin.end();

      opencodeProcess.stdout.on('data', (data) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processOpenCodeOutputLine(line.trim());
        });
      });

      opencodeProcess.stderr.on('data', (data) => {
        const stderrText = data.toString();
        if (!stderrText.trim()) {
          return;
        }

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: stderrText,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'opencode',
        }));
      });

      opencodeProcess.on('close', async (code) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activeOpenCodeProcesses.delete(finalSessionId);
        activeOpenCodeProcesses.delete(processKey);

        if (stdoutLineBuffer.trim()) {
          processOpenCodeOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }

        // OpenCode's own database is keyed by the provider-native id.
        const tokenBudget = readOpenCodeTokenUsage(capturedSessionId);
        if (tokenBudget) {
          ws.send(createNormalizedMessage({
            kind: 'status',
            text: 'token_budget',
            tokenBudget,
            sessionId: finalSessionId,
            provider: 'opencode',
          }));
        }

        // Terminal complete — skipped for aborted runs (abort-session
        // already sent the aborted complete on this run's behalf).
        if (!completeSent && !opencodeProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'opencode', sessionId: finalSessionId, exitCode: code }));
        }

        if (code === 0) {
          notifyTerminalState({ code });
          resolve();
          return;
        }

        if (code === 127 || code === null) {
          const installed = await context.isProviderInstalled();
          if (!installed) {
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: 'OpenCode CLI is not installed. Install it from https://opencode.ai/docs/',
              sessionId: finalSessionId,
              provider: 'opencode',
            }));
          }
        }

        notifyTerminalState({ code });
        reject(new Error(code === null ? 'OpenCode CLI process was terminated' : `OpenCode CLI exited with code ${code}`));
      });

      opencodeProcess.on('error', async (error) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activeOpenCodeProcesses.delete(finalSessionId);
        activeOpenCodeProcesses.delete(processKey);

        const installed = await context.isProviderInstalled();
        const errorContent = !installed
          ? 'OpenCode CLI is not installed. Install it from https://opencode.ai/docs/'
          : error.message;

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: finalSessionId,
          provider: 'opencode',
        }));
        if (!completeSent && !opencodeProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'opencode', sessionId: finalSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortOpenCodeSession(sessionId) {
  const process = activeOpenCodeProcesses.get(sessionId);
  if (!process) {
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  process.aborted = true;
  process.kill('SIGTERM');
  activeOpenCodeProcesses.delete(sessionId);
  return true;
}

function isOpenCodeSessionActive(sessionId) {
  return activeOpenCodeProcesses.has(sessionId);
}

function getActiveOpenCodeSessions() {
  return Array.from(activeOpenCodeProcesses.keys());
}

export const opencodeRuntime = {
  run: spawnOpenCode,
  abort: abortOpenCodeSession,
};

export {
  spawnOpenCode,
  abortOpenCodeSession,
  isOpenCodeSessionActive,
  getActiveOpenCodeSessions,
};
