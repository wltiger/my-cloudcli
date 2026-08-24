import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { OPENCODE_SESSION_END_ANCHOR } from './opencode-anchors.js';
import {
  isOpenCodeCompactCommand,
  isOpenCodeSessionActive,
  opencodeRuntime,
  resolveOpenCodePermissionOptions,
  splitOpenCodeModelId,
} from './opencode-runtime.provider.js';
import { forkOpenCodeSession, withOpenCodeServe } from './opencode-serve.js';
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
 * `POST .../fork` and the `PATCH` that renames its result answer the same way,
 * under OPENCODE_FORK_BEHAVIOR.
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
    const forkCapturePath = process.env.OPENCODE_FORK_CAPTURE;
    if (req.url.indexOf('/fork') !== -1) {
      if (forkCapturePath) {
        require('node:fs').writeFileSync(forkCapturePath, JSON.stringify({
          method: req.method,
          url: req.url,
          body: body,
        }));
      }
      if (process.env.OPENCODE_FORK_BEHAVIOR === 'html-trap') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><body>CloudCLI</body></html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'ses_forked', title: 'source (fork #1)' }));
      return;
    }
    if (req.method === 'PATCH') {
      if (process.env.OPENCODE_RENAME_CAPTURE) {
        require('node:fs').writeFileSync(process.env.OPENCODE_RENAME_CAPTURE, JSON.stringify({
          method: req.method,
          url: req.url,
          body: body,
        }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'ses_forked', title: JSON.parse(body).title }));
      return;
    }
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

test('withOpenCodeServe shuts the ephemeral server down on both success and throw', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-serve-'));
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousPortCapture = process.env.OPENCODE_SERVE_PORT_CAPTURE;

  try {
    await createFakeOpenCodeServeExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    const portCapturePath = path.join(tempRoot, 'serve-port.txt');
    process.env.OPENCODE_SERVE_PORT_CAPTURE = portCapturePath;

    // The operation is handed a server that is already answering, and its own
    // result comes straight back out.
    const reachedServer = await withOpenCodeServe(
      tempRoot,
      (serveHandle) => isPortReachable(Number(new URL(serveHandle.baseUrl).port)),
    );
    assert.equal(reachedServer, true);

    let port = Number((await readFile(portCapturePath, 'utf8')).trim());
    assert.ok(await waitUntilPortUnreachable(port, 3000), 'expected the server to be shut down after the operation succeeded');

    // An operation that throws leaves nothing listening either. This is the
    // guarantee every Fork and Rewind call rests on, and the reason the
    // start/use/shut-down bracket is written once rather than per caller.
    await assert.rejects(
      withOpenCodeServe(tempRoot, async () => {
        throw new Error('operation failed');
      }),
      /operation failed/,
    );

    port = Number((await readFile(portCapturePath, 'utf8')).trim());
    assert.ok(await waitUntilPortUnreachable(port, 3000), 'expected the server to be shut down after the operation threw');
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

    if (previousPortCapture === undefined) {
      delete process.env.OPENCODE_SERVE_PORT_CAPTURE;
    } else {
      process.env.OPENCODE_SERVE_PORT_CAPTURE = previousPortCapture;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('forkOpenCodeSession forks through the ephemeral server, renames the copy, and always shuts the server down', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-fork-'));
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousForkBehavior = process.env.OPENCODE_FORK_BEHAVIOR;
  const previousForkCapture = process.env.OPENCODE_FORK_CAPTURE;
  const previousRenameCapture = process.env.OPENCODE_RENAME_CAPTURE;
  const previousPortCapture = process.env.OPENCODE_SERVE_PORT_CAPTURE;

  try {
    await createFakeOpenCodeServeExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    const forkCapturePath = path.join(tempRoot, 'fork-request.json');
    const renameCapturePath = path.join(tempRoot, 'rename-request.json');
    const portCapturePath = path.join(tempRoot, 'serve-port.txt');
    process.env.OPENCODE_FORK_CAPTURE = forkCapturePath;
    process.env.OPENCODE_RENAME_CAPTURE = renameCapturePath;
    process.env.OPENCODE_SERVE_PORT_CAPTURE = portCapturePath;

    const forkedSessionId = await forkOpenCodeSession('ses_source', {
      cwd: tempRoot,
      anchor: 'msg_next_turn',
      title: '[Fork] Write hi to hello.txt',
    });

    assert.equal(forkedSessionId, 'ses_forked');

    // The legacy unprefixed route is the only one that forks; `/api/...` falls
    // through to the web UI's HTML catch-all.
    const forkRequest = JSON.parse(await readFile(forkCapturePath, 'utf8'));
    assert.equal(forkRequest.method, 'POST');
    assert.match(forkRequest.url, /^\/session\/ses_source\/fork$/);
    assert.deepEqual(JSON.parse(forkRequest.body), { messageID: 'msg_next_turn' });

    // The fork endpoint takes no title, so the `[Fork]` name is a second call.
    const renameRequest = JSON.parse(await readFile(renameCapturePath, 'utf8'));
    assert.match(renameRequest.url, /^\/session\/ses_forked$/);
    assert.deepEqual(JSON.parse(renameRequest.body), { title: '[Fork] Write hi to hello.txt' });

    let port = Number((await readFile(portCapturePath, 'utf8')).trim());
    assert.ok(await waitUntilPortUnreachable(port, 3000), 'expected the server to be shut down after the fork');

    // The newest turn has no message after it to name, so its anchor asks for
    // the whole session — which OpenCode copies when sent no messageID at all.
    await forkOpenCodeSession('ses_source', {
      cwd: tempRoot,
      anchor: OPENCODE_SESSION_END_ANCHOR,
      title: '[Fork] Write hi to hello.txt (2)',
    });
    assert.deepEqual(JSON.parse(JSON.parse(await readFile(forkCapturePath, 'utf8')).body), {});

    // A 200 carrying the HTML catch-all must read as failure, not as a fork.
    process.env.OPENCODE_FORK_BEHAVIOR = 'html-trap';
    await assert.rejects(
      forkOpenCodeSession('ses_source', { cwd: tempRoot, anchor: 'msg_next_turn', title: '[Fork] trapped' }),
      /OpenCode fork failed/,
    );

    port = Number((await readFile(portCapturePath, 'utf8')).trim());
    assert.ok(await waitUntilPortUnreachable(port, 3000), 'expected the server to be shut down after the fork failed');
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

    if (previousForkBehavior === undefined) {
      delete process.env.OPENCODE_FORK_BEHAVIOR;
    } else {
      process.env.OPENCODE_FORK_BEHAVIOR = previousForkBehavior;
    }

    if (previousForkCapture === undefined) {
      delete process.env.OPENCODE_FORK_CAPTURE;
    } else {
      process.env.OPENCODE_FORK_CAPTURE = previousForkCapture;
    }

    if (previousRenameCapture === undefined) {
      delete process.env.OPENCODE_RENAME_CAPTURE;
    } else {
      process.env.OPENCODE_RENAME_CAPTURE = previousRenameCapture;
    }

    if (previousPortCapture === undefined) {
      delete process.env.OPENCODE_SERVE_PORT_CAPTURE;
    } else {
      process.env.OPENCODE_SERVE_PORT_CAPTURE = previousPortCapture;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * A fake `opencode` that is both halves of a Rewind: `serve` starts a real HTTP
 * server answering the legacy `revert`/`unrevert` routes, and `run` is the send
 * that rides with it. One executable rather than two because a Rewind is two
 * calls to the same binary — that is the whole reason it needs its own path.
 *
 * `OPENCODE_RUN_BEHAVIOR=fail` makes the send exit non-zero, which is the case
 * that has to put the reader's files back.
 */
async function createFakeOpenCodeRewindExecutable(binDir) {
  const scriptPath = path.join(binDir, 'opencode.js');
  await writeFile(scriptPath, `
const fs = require('node:fs');

if (process.argv[2] !== 'serve') {
  if (process.env.OPENCODE_RUN_CAPTURE) {
    fs.writeFileSync(process.env.OPENCODE_RUN_CAPTURE, JSON.stringify({ args: process.argv.slice(2) }));
  }
  if (process.env.OPENCODE_RUN_BEHAVIOR === 'fail') {
    process.stderr.write('run failed\\n');
    process.exit(3);
  }
  console.log(JSON.stringify({ type: 'text', sessionID: 'ses_rewound', text: 'assistant response' }));
  console.log(JSON.stringify({ type: 'step_finish', sessionID: 'ses_rewound' }));
  process.exit(0);
}

const http = require('node:http');
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (process.env.OPENCODE_REVERT_CAPTURE) {
      fs.appendFileSync(process.env.OPENCODE_REVERT_CAPTURE, JSON.stringify({
        method: req.method,
        url: req.url,
        body: body,
      }) + '\\n');
    }
    if (process.env.OPENCODE_REVERT_BEHAVIOR === 'html-trap') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body>CloudCLI</body></html>');
      return;
    }
    if (process.env.OPENCODE_SESSION_READ_FAILS && req.method === 'GET') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.indexOf('/unrevert') !== -1) {
      res.end(JSON.stringify({ id: 'ses_1' }));
      return;
    }
    // The session read the undo path takes first. OPENCODE_COMMITTED=1 is the
    // measured case where \`opencode run\` already committed the revert, so
    // there is nothing left to put back.
    if (req.method === 'GET') {
      res.end(JSON.stringify(process.env.OPENCODE_COMMITTED
        ? { id: 'ses_1' }
        : { id: 'ses_1', revert: { messageID: 'msg_u2' } }));
      return;
    }
    res.end(JSON.stringify({ id: 'ses_1', revert: { messageID: JSON.parse(body).messageID } }));
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (process.env.OPENCODE_SERVE_PORT_CAPTURE) {
    fs.writeFileSync(process.env.OPENCODE_SERVE_PORT_CAPTURE, String(address.port));
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

test('spawnOpenCode reverts before the send, and unreverts when the send fails', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-rewind-'));
  const pathKey = findEnvKey('PATH');
  const pathExtKey = findEnvKey('PATHEXT');
  const previousPath = process.env[pathKey];
  const previousPathExt = process.env[pathExtKey];
  const previousRevertCapture = process.env.OPENCODE_REVERT_CAPTURE;
  const previousRunCapture = process.env.OPENCODE_RUN_CAPTURE;
  const previousRunBehavior = process.env.OPENCODE_RUN_BEHAVIOR;
  const previousCommitted = process.env.OPENCODE_COMMITTED;
  const previousSessionReadFails = process.env.OPENCODE_SESSION_READ_FAILS;
  const previousPortCapture = process.env.OPENCODE_SERVE_PORT_CAPTURE;
  const messages = [];
  const writer = { userId: null, send: (message) => messages.push(message) };
  const readRequests = async (capturePath) => (await readFile(capturePath, 'utf8'))
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  try {
    await createFakeOpenCodeRewindExecutable(tempRoot);
    process.env[pathKey] = `${tempRoot}${path.delimiter}${previousPath || ''}`;
    if (process.platform === 'win32') {
      process.env[pathExtKey] = previousPathExt?.toUpperCase().includes('.CMD')
        ? previousPathExt
        : `.COM;.EXE;.BAT;.CMD${previousPathExt ? `;${previousPathExt}` : ''}`;
    }

    const revertCapturePath = path.join(tempRoot, 'revert-requests.jsonl');
    const runCapturePath = path.join(tempRoot, 'run-args.json');
    const portCapturePath = path.join(tempRoot, 'serve-port.txt');
    process.env.OPENCODE_REVERT_CAPTURE = revertCapturePath;
    process.env.OPENCODE_RUN_CAPTURE = runCapturePath;
    process.env.OPENCODE_SERVE_PORT_CAPTURE = portCapturePath;

    await opencodeRuntime.run(
      'try that again',
      { sessionId: 'ses_1', cwd: tempRoot, resumeSessionAt: 'msg_u2' },
      writer,
      runtimeContext,
    );

    // One revert, at the legacy unprefixed route, naming the Anchor verbatim —
    // OpenCode's revert is inclusive, so the Anchor is the message itself.
    const requests = await readRequests(revertCapturePath);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.match(requests[0].url, /^\/session\/ses_1\/revert$/);
    assert.deepEqual(JSON.parse(requests[0].body), { messageID: 'msg_u2' });

    // ...and then an ordinary send under the same session id, with the Anchor
    // dropped rather than passed on to a CLI that has no flag for it.
    const runArgs = JSON.parse(await readFile(runCapturePath, 'utf8')).args;
    assert.deepEqual(runArgs.slice(0, 3), ['run', '--format', 'json']);
    assert.equal(runArgs[runArgs.indexOf('--session') + 1], 'ses_1');
    assert.equal(runArgs.includes('msg_u2'), false);
    assert.ok(messages.some((message) => message.kind === 'stream_delta'));
    assert.equal(messages.some((message) => message.kind === 'error'), false);

    const port = Number((await readFile(portCapturePath, 'utf8')).trim());
    assert.ok(await waitUntilPortUnreachable(port, 3000), 'expected the server to be shut down after the revert');

    // A send that fails after the revert succeeded leaves the reader with
    // rolled-back files and nothing to show for it, so both go back.
    await rm(revertCapturePath, { force: true });
    messages.length = 0;
    process.env.OPENCODE_RUN_BEHAVIOR = 'fail';
    await assert.rejects(opencodeRuntime.run(
      'try that again',
      { sessionId: 'ses_1', cwd: tempRoot, resumeSessionAt: 'msg_u2' },
      writer,
      runtimeContext,
    ));

    const recovered = await readRequests(revertCapturePath);
    assert.deepEqual(recovered.map((request) => request.url), [
      '/session/ses_1/revert',
      '/session/ses_1',
      '/session/ses_1/unrevert',
    ]);
    // Silent recovery is not acceptable: their working tree moved twice.
    assert.ok(messages.some((message) =>
      message.kind === 'error' && /the Rewind was undone/.test(message.content),
    ));

    // Measured: `opencode run` commits an outstanding revert as soon as it
    // appends its own user message, so most failures surface with nothing left
    // to undo — and `unrevert` would still answer 200. Claiming the files came
    // back there would be a lie, so the session is read first and the reader is
    // told what actually happened.
    await rm(revertCapturePath, { force: true });
    messages.length = 0;
    process.env.OPENCODE_COMMITTED = '1';
    await assert.rejects(opencodeRuntime.run(
      'try that again',
      { sessionId: 'ses_1', cwd: tempRoot, resumeSessionAt: 'msg_u2' },
      writer,
      runtimeContext,
    ));

    const committed = await readRequests(revertCapturePath);
    assert.equal(committed.some((request) => request.url.endsWith('/unrevert')), false);
    assert.ok(messages.some((message) =>
      message.kind === 'error' && /had already applied the Rewind/.test(message.content),
    ));

    // A session read that fails is evidence of nothing. Reading it is the whole
    // mechanism for telling a committed revert from a standing one, so a 500
    // there leaves the question open — and an open question must not be
    // reported as the settled, unrecoverable answer.
    await rm(revertCapturePath, { force: true });
    messages.length = 0;
    delete process.env.OPENCODE_COMMITTED;
    process.env.OPENCODE_SESSION_READ_FAILS = '1';
    await assert.rejects(opencodeRuntime.run(
      'try that again',
      { sessionId: 'ses_1', cwd: tempRoot, resumeSessionAt: 'msg_u2' },
      writer,
      runtimeContext,
    ));

    const unreadable = await readRequests(revertCapturePath);
    assert.equal(unreadable.some((request) => request.url.endsWith('/unrevert')), false);
    assert.ok(messages.some((message) =>
      message.kind === 'error' && /could not be undone/.test(message.content),
    ));
    assert.equal(messages.some((message) =>
      /had already applied the Rewind/.test(message.content || ''),
    ), false);
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

    for (const [name, previous] of [
      ['OPENCODE_REVERT_CAPTURE', previousRevertCapture],
      ['OPENCODE_RUN_CAPTURE', previousRunCapture],
      ['OPENCODE_RUN_BEHAVIOR', previousRunBehavior],
      ['OPENCODE_COMMITTED', previousCommitted],
      ['OPENCODE_SESSION_READ_FAILS', previousSessionReadFails],
      ['OPENCODE_SERVE_PORT_CAPTURE', previousPortCapture],
    ]) {
      if (previous === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous;
      }
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});
