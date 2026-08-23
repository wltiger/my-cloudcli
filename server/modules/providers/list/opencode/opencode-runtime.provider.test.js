import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isOpenCodeCompactCommand,
  isOpenCodeSessionActive,
  opencodeRuntime,
  resolveOpenCodePermissionOptions,
  splitOpenCodeModelId,
} from './opencode-runtime.provider.js';
import { OpenCodeSessionsProvider } from './opencode-sessions.provider.js';

const sessionsProvider = new OpenCodeSessionsProvider();
const runtimeContext = {
  resolveProviderSessionId: (sessionId) => sessionId || null,
  resolveResumeModel: async (_sessionId, requestedModel) => requestedModel || undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
  normalizeMessage: (raw, sessionId) => sessionsProvider.normalizeMessage(raw, sessionId),
  isProviderInstalled: async () => true,
};

const findEnvKey = (name) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

async function createFakeOpenCodeExecutable(binDir) {
  const scriptPath = path.join(binDir, 'opencode.js');
  await writeFile(scriptPath, `
const capturePath = process.env.OPENCODE_ARGS_CAPTURE;
if (capturePath) {
  require('node:fs').writeFileSync(capturePath, JSON.stringify({
    args: process.argv.slice(2),
    permissionEnv: process.env.OPENCODE_PERMISSION ?? null,
  }));
}

const events = [
  { type: 'text', sessionID: 'open-live-1', text: 'assistant response' },
  { type: 'step_finish', sessionID: 'open-live-1' },
];

for (const event of events) {
  console.log(JSON.stringify(event));
}
`, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, 'opencode.cmd');
    await writeFile(commandPath, '@echo off\r\nnode "%~dp0opencode.js" %*\r\n', 'utf8');
    return;
  }

  const commandPath = path.join(binDir, 'opencode');
  await writeFile(commandPath, '#!/bin/sh\nnode "$(dirname "$0")/opencode.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
}

/**
 * A fake `opencode serve` that starts a real HTTP server on an OS-assigned
 * port, matching the real CLI's stdout announcement so the runtime's
 * readiness parsing is exercised for real. `POST .../summarize` responds
 * according to OPENCODE_SUMMARIZE_BEHAVIOR so tests can exercise the success
 * shape, the HTML-catch-all trap, and a 503 without touching a real server.
 */
async function createFakeOpenCodeServeExecutable(binDir) {
  const scriptPath = path.join(binDir, 'opencode.js');
  await writeFile(scriptPath, `
const capturePath = process.env.OPENCODE_ARGS_CAPTURE;
if (capturePath) {
  require('node:fs').writeFileSync(capturePath, JSON.stringify({
    args: process.argv.slice(2),
  }));
}

const http = require('node:http');
const requestCapturePath = process.env.OPENCODE_SUMMARIZE_CAPTURE;
const portCapturePath = process.env.OPENCODE_SERVE_PORT_CAPTURE;

// Never reaches "listening": the side channel must give up and leave nothing
// registered, rather than waiting on a server that will never answer.
if (process.env.OPENCODE_SERVE_BEHAVIOR === 'never-listen') {
  process.stderr.write('failed to bind port\\n');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const behavior = process.env.OPENCODE_SUMMARIZE_BEHAVIOR || 'success';
    if (requestCapturePath && req.url.indexOf('/summarize') !== -1) {
      require('node:fs').writeFileSync(requestCapturePath, JSON.stringify({
        method: req.method,
        url: req.url,
        body: body,
      }));
    }
    if (behavior === 'html-trap') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body>CloudCLI</body></html>');
      return;
    }
    if (behavior === 'unavailable') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Session compact is not available yet' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('true');
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (portCapturePath) {
    require('node:fs').writeFileSync(portCapturePath, String(address.port));
  }
  console.log('opencode server listening on http://127.0.0.1:' + address.port);
});
`, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, 'opencode.cmd');
    await writeFile(commandPath, '@echo off\r\nnode "%~dp0opencode.js" %*\r\n', 'utf8');
    return;
  }

  const commandPath = path.join(binDir, 'opencode');
  await writeFile(commandPath, '#!/bin/sh\nnode "$(dirname "$0")/opencode.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
}

/** True while something on 127.0.0.1:port answers, even with an error status. */
async function isPortReachable(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    await response.text().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Polls until the ephemeral server's port stops answering, proving it shut down. */
async function waitUntilPortUnreachable(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortReachable(port))) {
      return true;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  return false;
}

test('spawnOpenCode emits session_created before normalized live messages for new sessions', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-live-'));
  const argsCapturePath = path.join(tempRoot, 'opencode-args.json');
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousArgsCapture = process.env.OPENCODE_ARGS_CAPTURE;
  const messages = [];
  const writer = {
    userId: null,
    sessionId: null,
    send(message) {
      messages.push(message);
    },
    setSessionId(sessionId) {
      this.sessionId = sessionId;
    },
  };

  try {
    await createFakeOpenCodeExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    process.env.OPENCODE_ARGS_CAPTURE = argsCapturePath;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    await opencodeRuntime.run('Hi', { cwd: tempRoot }, writer, runtimeContext);

    const sessionCreatedIndex = messages.findIndex((message) => message.kind === 'session_created');
    const assistantDeltaIndex = messages.findIndex((message) =>
      message.kind === 'stream_delta' && message.content === 'assistant response',
    );
    const streamEnd = messages.find((message) => message.kind === 'stream_end');
    const complete = messages.find((message) => message.kind === 'complete');

    assert.notEqual(sessionCreatedIndex, -1);
    assert.notEqual(assistantDeltaIndex, -1);
    assert.ok(sessionCreatedIndex < assistantDeltaIndex);
    assert.equal(messages[sessionCreatedIndex].newSessionId, 'open-live-1');
    assert.equal(writer.sessionId, 'open-live-1');
    assert.equal(streamEnd?.sessionId, 'open-live-1');
    assert.equal(complete?.sessionId, 'open-live-1');
    assert.equal(messages.some((message) => message.kind === 'error'), false);

    const capture = JSON.parse(await readFile(argsCapturePath, 'utf8'));
    const launchedArgs = capture.args;
    assert.ok(Array.isArray(launchedArgs));
    assert.deepEqual(launchedArgs.slice(0, 4), ['run', '--format', 'json', '--dir']);
    assert.equal(launchedArgs[4], tempRoot);
    // No permission mode requested → no permission flags and no env override.
    assert.equal(launchedArgs.includes('--auto'), false);
    assert.equal(launchedArgs.includes('--agent'), false);
    assert.equal(capture.permissionEnv, null);

    const attachmentOnlyCapturePath = path.join(tempRoot, 'opencode-attachment-only.json');
    process.env.OPENCODE_ARGS_CAPTURE = attachmentOnlyCapturePath;
    await opencodeRuntime.run(
      '',
      {
        cwd: tempRoot,
        files: [{
          path: path.join(tempRoot, 'brief.pdf'),
          name: 'brief.pdf',
          mimeType: 'application/pdf',
        }],
      },
      writer,
      runtimeContext,
    );
    const attachmentOnlyCapture = JSON.parse(await readFile(attachmentOnlyCapturePath, 'utf8'));
    const attachmentPrompt = attachmentOnlyCapture.args[attachmentOnlyCapture.args.length - 1];
    assert.match(attachmentPrompt, /<files_input>/);
    assert.match(attachmentPrompt, /brief\.pdf/);
  } finally {
    if (previousPath === undefined) {
      delete process.env[pathKey];
    } else {
      process.env[pathKey] = previousPath;
    }

    if (previousPathExt === undefined) {
      delete process.env[pathExtKey];
    } else {
      process.env[pathExtKey] = previousPathExt;
    }

    if (previousArgsCapture === undefined) {
      delete process.env.OPENCODE_ARGS_CAPTURE;
    } else {
      process.env.OPENCODE_ARGS_CAPTURE = previousArgsCapture;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('resolveOpenCodePermissionOptions maps UI permission modes onto OpenCode controls', () => {
  assert.deepEqual(resolveOpenCodePermissionOptions('plan'), {
    args: ['--agent', 'plan'],
    env: {},
  });
  assert.deepEqual(resolveOpenCodePermissionOptions('bypassPermissions'), {
    args: ['--auto'],
    env: {},
  });
  assert.deepEqual(resolveOpenCodePermissionOptions('acceptEdits'), {
    args: [],
    env: { OPENCODE_PERMISSION: '{"edit":"allow"}' },
  });
  // default and anything unknown leave the user's own opencode config in charge.
  assert.deepEqual(resolveOpenCodePermissionOptions('default'), { args: [], env: {} });
  assert.deepEqual(resolveOpenCodePermissionOptions(undefined), { args: [], env: {} });
});

test('spawnOpenCode passes permission mode flags and env to the CLI', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-perms-'));
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousArgsCapture = process.env.OPENCODE_ARGS_CAPTURE;
  const writer = {
    userId: null,
    sessionId: null,
    send() {},
    setSessionId(sessionId) {
      this.sessionId = sessionId;
    },
  };

  try {
    await createFakeOpenCodeExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    const scenarios = [
      {
        permissionMode: 'plan',
        expectArgs: ['--agent', 'plan'],
        expectPermissionEnv: null,
      },
      {
        permissionMode: 'bypassPermissions',
        expectArgs: ['--auto'],
        expectPermissionEnv: null,
      },
      {
        permissionMode: 'acceptEdits',
        expectArgs: [],
        expectPermissionEnv: '{"edit":"allow"}',
      },
    ];

    for (const scenario of scenarios) {
      const argsCapturePath = path.join(tempRoot, `opencode-args-${scenario.permissionMode}.json`);
      process.env.OPENCODE_ARGS_CAPTURE = argsCapturePath;

      await opencodeRuntime.run(
        'Hi',
        { cwd: tempRoot, permissionMode: scenario.permissionMode },
        writer,
        runtimeContext,
      );

      const capture = JSON.parse(await readFile(argsCapturePath, 'utf8'));
      for (const expectedArg of scenario.expectArgs) {
        assert.ok(
          capture.args.includes(expectedArg),
          `${scenario.permissionMode}: expected "${expectedArg}" in ${JSON.stringify(capture.args)}`,
        );
      }
      // The prompt stays the last positional argument, after any permission flags.
      assert.equal(capture.args[capture.args.length - 1], 'Hi');
      assert.equal(capture.permissionEnv, scenario.expectPermissionEnv);
    }
  } finally {
    if (previousPath === undefined) {
      delete process.env[pathKey];
    } else {
      process.env[pathKey] = previousPath;
    }

    if (previousPathExt === undefined) {
      delete process.env[pathExtKey];
    } else {
      process.env[pathExtKey] = previousPathExt;
    }

    if (previousArgsCapture === undefined) {
      delete process.env.OPENCODE_ARGS_CAPTURE;
    } else {
      process.env.OPENCODE_ARGS_CAPTURE = previousArgsCapture;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('splitOpenCodeModelId splits a resolved provider/model id and rejects anything else', () => {
  assert.deepEqual(splitOpenCodeModelId('anthropic/claude-sonnet-5'), {
    providerID: 'anthropic',
    modelID: 'claude-sonnet-5',
  });
  assert.deepEqual(splitOpenCodeModelId('opencode/gpt-5.6-terra'), {
    providerID: 'opencode',
    modelID: 'gpt-5.6-terra',
  });
  assert.equal(splitOpenCodeModelId('no-slash-model'), null);
  assert.equal(splitOpenCodeModelId('/leading-slash'), null);
  assert.equal(splitOpenCodeModelId('trailing-slash/'), null);
  assert.equal(splitOpenCodeModelId(''), null);
  assert.equal(splitOpenCodeModelId(undefined), null);
});

test('isOpenCodeCompactCommand only matches the exact /compact command', () => {
  assert.equal(isOpenCodeCompactCommand('/compact'), true);
  assert.equal(isOpenCodeCompactCommand('  /compact  '), true);
  assert.equal(isOpenCodeCompactCommand('/compact please'), false);
  assert.equal(isOpenCodeCompactCommand('hello'), false);
  assert.equal(isOpenCodeCompactCommand(''), false);
  assert.equal(isOpenCodeCompactCommand(undefined), false);
  assert.equal(isOpenCodeCompactCommand(null), false);
});

test('spawnOpenCode runs /compact through the summarize side channel and shuts the ephemeral server down', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-compact-'));
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousArgsCapture = process.env.OPENCODE_ARGS_CAPTURE;
  const previousBehavior = process.env.OPENCODE_SUMMARIZE_BEHAVIOR;
  const previousSummarizeCapture = process.env.OPENCODE_SUMMARIZE_CAPTURE;
  const previousPortCapture = process.env.OPENCODE_SERVE_PORT_CAPTURE;
  const messages = [];
  const writer = {
    userId: null,
    sessionId: null,
    send(message) {
      messages.push(message);
    },
    setSessionId(sessionId) {
      this.sessionId = sessionId;
    },
  };

  try {
    await createFakeOpenCodeServeExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    const argsCapturePath = path.join(tempRoot, 'serve-args.json');
    const summarizeCapturePath = path.join(tempRoot, 'summarize-request.json');
    const portCapturePath = path.join(tempRoot, 'serve-port.txt');
    process.env.OPENCODE_ARGS_CAPTURE = argsCapturePath;
    process.env.OPENCODE_SUMMARIZE_BEHAVIOR = 'success';
    process.env.OPENCODE_SUMMARIZE_CAPTURE = summarizeCapturePath;
    process.env.OPENCODE_SERVE_PORT_CAPTURE = portCapturePath;

    await opencodeRuntime.run(
      '/compact',
      { cwd: tempRoot, sessionId: 'app-session-1', model: 'anthropic/claude-sonnet-5' },
      writer,
      runtimeContext,
    );

    const serveArgs = JSON.parse(await readFile(argsCapturePath, 'utf8'));
    assert.deepEqual(serveArgs.args, ['serve', '--port', '0', '--hostname', '127.0.0.1']);

    const summarizeRequest = JSON.parse(await readFile(summarizeCapturePath, 'utf8'));
    assert.equal(summarizeRequest.method, 'POST');
    assert.match(summarizeRequest.url, /\/session\/app-session-1\/summarize$/);
    assert.deepEqual(JSON.parse(summarizeRequest.body), {
      providerID: 'anthropic',
      modelID: 'claude-sonnet-5',
    });

    const complete = messages.find((message) => message.kind === 'complete');
    assert.ok(complete);
    assert.equal(complete.success, true);
    assert.equal(messages.some((message) => message.kind === 'error'), false);

    const port = Number((await readFile(portCapturePath, 'utf8')).trim());
    const shutDown = await waitUntilPortUnreachable(port, 3000);
    assert.ok(shutDown, 'expected the ephemeral OpenCode server to be shut down after Compact finished');
  } finally {
    if (previousPath === undefined) {
      delete process.env[pathKey];
    } else {
      process.env[pathKey] = previousPath;
    }

    if (previousPathExt === undefined) {
      delete process.env[pathExtKey];
    } else {
      process.env[pathExtKey] = previousPathExt;
    }

    if (previousArgsCapture === undefined) {
      delete process.env.OPENCODE_ARGS_CAPTURE;
    } else {
      process.env.OPENCODE_ARGS_CAPTURE = previousArgsCapture;
    }

    if (previousBehavior === undefined) {
      delete process.env.OPENCODE_SUMMARIZE_BEHAVIOR;
    } else {
      process.env.OPENCODE_SUMMARIZE_BEHAVIOR = previousBehavior;
    }

    if (previousSummarizeCapture === undefined) {
      delete process.env.OPENCODE_SUMMARIZE_CAPTURE;
    } else {
      process.env.OPENCODE_SUMMARIZE_CAPTURE = previousSummarizeCapture;
    }

    if (previousPortCapture === undefined) {
      delete process.env.OPENCODE_SERVE_PORT_CAPTURE;
    } else {
      process.env.OPENCODE_SERVE_PORT_CAPTURE = previousPortCapture;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('spawnOpenCode treats a non-boolean summarize response as Compact failure and still shuts the server down', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-compact-fail-'));
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousBehavior = process.env.OPENCODE_SUMMARIZE_BEHAVIOR;
  const previousPortCapture = process.env.OPENCODE_SERVE_PORT_CAPTURE;

  try {
    await createFakeOpenCodeServeExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    // html-trap: the wrong route falling through to the web UI's HTML
    // catch-all — a 200 that must not be read as success.
    // unavailable: the published-but-unimplemented /api/.../compact 503 shape.
    const scenarios = ['html-trap', 'unavailable'];

    for (const behavior of scenarios) {
      const messages = [];
      const writer = {
        userId: null,
        sessionId: null,
        send(message) {
          messages.push(message);
        },
        setSessionId() {},
      };
      const portCapturePath = path.join(tempRoot, `serve-port-${behavior}.txt`);
      process.env.OPENCODE_SUMMARIZE_BEHAVIOR = behavior;
      process.env.OPENCODE_SERVE_PORT_CAPTURE = portCapturePath;

      await opencodeRuntime.run(
        '/compact',
        { cwd: tempRoot, sessionId: 'app-session-1', model: 'anthropic/claude-sonnet-5' },
        writer,
        runtimeContext,
      );

      const complete = messages.find((message) => message.kind === 'complete');
      assert.ok(complete, `${behavior}: expected a terminal complete message`);
      assert.equal(complete.success, false, `${behavior}: expected Compact to be reported as failed`);
      assert.ok(
        messages.some((message) => message.kind === 'error'),
        `${behavior}: expected an error message surfaced to the conversation`,
      );

      const port = Number((await readFile(portCapturePath, 'utf8')).trim());
      const shutDown = await waitUntilPortUnreachable(port, 3000);
      assert.ok(shutDown, `${behavior}: expected the ephemeral OpenCode server to be shut down after Compact failed`);
    }
  } finally {
    if (previousPath === undefined) {
      delete process.env[pathKey];
    } else {
      process.env[pathKey] = previousPath;
    }

    if (previousPathExt === undefined) {
      delete process.env[pathExtKey];
    } else {
      process.env[pathExtKey] = previousPathExt;
    }

    if (previousBehavior === undefined) {
      delete process.env.OPENCODE_SUMMARIZE_BEHAVIOR;
    } else {
      process.env.OPENCODE_SUMMARIZE_BEHAVIOR = previousBehavior;
    }

    if (previousPortCapture === undefined) {
      delete process.env.OPENCODE_SERVE_PORT_CAPTURE;
    } else {
      process.env.OPENCODE_SERVE_PORT_CAPTURE = previousPortCapture;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('spawnOpenCode reports a friendly error for /compact when there is nothing to compact yet, without starting a server', async () => {
  const messages = [];
  const writer = {
    userId: null,
    sessionId: null,
    send(message) {
      messages.push(message);
    },
    setSessionId() {},
  };
  const noSessionContext = {
    ...runtimeContext,
    resolveProviderSessionId: () => null,
  };

  await opencodeRuntime.run('/compact', { cwd: process.cwd() }, writer, noSessionContext);

  const complete = messages.find((message) => message.kind === 'complete');
  assert.ok(complete);
  assert.equal(complete.success, false);
  assert.ok(messages.some((message) => message.kind === 'error'));
});

test('spawnOpenCode gives up cleanly when the ephemeral server never becomes reachable', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-compact-unreachable-'));
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousServeBehavior = process.env.OPENCODE_SERVE_BEHAVIOR;
  const messages = [];
  const writer = {
    userId: null,
    sessionId: null,
    send(message) {
      messages.push(message);
    },
    setSessionId(sessionId) {
      this.sessionId = sessionId;
    },
  };

  try {
    await createFakeOpenCodeServeExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }
    process.env.OPENCODE_SERVE_BEHAVIOR = 'never-listen';

    await opencodeRuntime.run(
      '/compact',
      { cwd: tempRoot, sessionId: 'app-session-unreachable', model: 'anthropic/claude-sonnet-5' },
      writer,
      runtimeContext,
    );

    const complete = messages.find((message) => message.kind === 'complete');
    assert.ok(complete, 'the run must still terminate');
    assert.equal(complete.success, false);
    assert.ok(
      messages.some((message) => message.kind === 'error'),
      'the failure must be surfaced rather than swallowed',
    );
    // The registry entry exists only for the duration of the side channel, so
    // a server that never answered must not leave the session looking active.
    assert.equal(isOpenCodeSessionActive('app-session-unreachable'), false);
  } finally {
    process.env[pathKey] = previousPath;
    if (previousPathExt === undefined) {
      delete process.env[pathExtKey];
    } else {
      process.env[pathExtKey] = previousPathExt;
    }
    if (previousServeBehavior === undefined) {
      delete process.env.OPENCODE_SERVE_BEHAVIOR;
    } else {
      process.env.OPENCODE_SERVE_BEHAVIOR = previousServeBehavior;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
