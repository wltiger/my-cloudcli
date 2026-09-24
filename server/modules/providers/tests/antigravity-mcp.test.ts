/**
 * Antigravity MCP servers, written to and read from `agy`'s own config files
 * under a temporary home.
 *
 * The point of the facet is that a server added in CloudCLI is a server `agy`
 * actually loads, so these tests read the config file back as `agy` would
 * rather than trusting the service's own return value.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import { AppError } from '@/shared/utils.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const readMcpServers = async (filePath: string): Promise<Record<string, any>> => {
  const config = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
  return (config.mcpServers ?? {}) as Record<string, any>;
};

async function withHome(
  run: (paths: { homeDir: string; workspacePath: string; userConfig: string; projectConfig: string }) => Promise<void>,
): Promise<void> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-mcp-'));
  const workspacePath = path.join(homeDir, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(homeDir);
  try {
    await run({
      homeDir,
      workspacePath,
      userConfig: path.join(homeDir, '.gemini', 'config', 'mcp_config.json'),
      projectConfig: path.join(workspacePath, '.agents', 'mcp_config.json'),
    });
  } finally {
    restoreHomeDir();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

test('a user-scope stdio server lands in the config agy shares with the IDE', { concurrency: false }, async () => {
  await withHome(async ({ workspacePath, userConfig }) => {
    await providerMcpService.upsertProviderMcpServer('antigravity', {
      name: 'agy-user-stdio',
      scope: 'user',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'my-server'],
      env: { API_KEY: 'secret' },
      workspacePath,
    });

    const written = (await readMcpServers(userConfig))['agy-user-stdio'];
    assert.equal(written.command, 'npx');
    assert.deepEqual(written.args, ['-y', 'my-server']);
    assert.deepEqual(written.env, { API_KEY: 'secret' });
    assert.equal(written.disabled, false);
  });
});

test('a project-scope server lands beside the workspace, not in the home config', { concurrency: false }, async () => {
  await withHome(async ({ workspacePath, userConfig, projectConfig }) => {
    await providerMcpService.upsertProviderMcpServer('antigravity', {
      name: 'agy-project-http',
      scope: 'project',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      workspacePath,
    });

    const written = (await readMcpServers(projectConfig))['agy-project-http'];
    assert.equal(written.serverUrl, 'https://example.com/mcp');
    assert.deepEqual(written.headers, { Authorization: 'Bearer token' });
    await assert.rejects(() => fs.readFile(userConfig, 'utf8'), 'the user config must not be touched');
  });
});

test('a remote server reads back as http, because agy stores one field for both', { concurrency: false }, async () => {
  await withHome(async ({ workspacePath }) => {
    await providerMcpService.upsertProviderMcpServer('antigravity', {
      name: 'agy-sse',
      scope: 'project',
      transport: 'sse',
      url: 'https://example.com/sse',
      workspacePath,
    });

    const servers = await providerMcpService.listProviderMcpServersForScope('antigravity', 'project', { workspacePath });
    const listed = servers.find((server) => server.name === 'agy-sse');

    // http and sse are indistinguishable on disk, so the picker must be shown
    // the transport the file can actually prove.
    assert.equal(listed?.transport, 'http');
    assert.equal(listed?.url, 'https://example.com/sse');
  });
});

test('agy has no provider-local scope', { concurrency: false }, async () => {
  await withHome(async ({ workspacePath }) => {
    await assert.rejects(
      () => providerMcpService.upsertProviderMcpServer('antigravity', {
        name: 'agy-local',
        scope: 'local',
        transport: 'stdio',
        command: 'npx',
        workspacePath,
      }),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
    );
  });
});

test('a stdio server with no command is refused before anything is written', { concurrency: false }, async () => {
  await withHome(async ({ workspacePath, projectConfig }) => {
    await assert.rejects(
      () => providerMcpService.upsertProviderMcpServer('antigravity', {
        name: 'agy-broken',
        scope: 'project',
        transport: 'stdio',
        command: '   ',
        workspacePath,
      }),
      (error: unknown) => error instanceof AppError
        && error.code === 'MCP_COMMAND_REQUIRED'
        && error.statusCode === 400,
    );

    await assert.rejects(() => fs.readFile(projectConfig, 'utf8'));
  });
});

test('editing and removing a server leaves the rest of the file alone', { concurrency: false }, async () => {
  await withHome(async ({ workspacePath, projectConfig }) => {
    await fs.mkdir(path.dirname(projectConfig), { recursive: true });
    // A config `agy` (or the user) wrote before CloudCLI ever ran.
    await fs.writeFile(projectConfig, JSON.stringify({
      someAgyOption: true,
      mcpServers: { 'hand-written': { command: 'node', args: ['server.js'] } },
    }, null, 2), 'utf8');

    await providerMcpService.upsertProviderMcpServer('antigravity', {
      name: 'agy-edited',
      scope: 'project',
      transport: 'stdio',
      command: 'npx',
      workspacePath,
    });
    await providerMcpService.upsertProviderMcpServer('antigravity', {
      name: 'agy-edited',
      scope: 'project',
      transport: 'stdio',
      command: 'bun',
      args: ['x', 'my-server'],
      workspacePath,
    });

    let servers = await readMcpServers(projectConfig);
    assert.equal(servers['agy-edited'].command, 'bun');
    assert.deepEqual(servers['agy-edited'].args, ['x', 'my-server']);
    assert.ok(servers['hand-written'], 'a server CloudCLI did not add must survive');

    await providerMcpService.removeProviderMcpServer('antigravity', {
      name: 'agy-edited',
      scope: 'project',
      workspacePath,
    });

    servers = await readMcpServers(projectConfig);
    assert.equal(servers['agy-edited'], undefined);
    assert.ok(servers['hand-written']);
    const config = JSON.parse(await fs.readFile(projectConfig, 'utf8')) as Record<string, unknown>;
    assert.equal(config.someAgyOption, true, 'unknown keys in agy\'s own config must survive');
  });
});

test('an entry agy wrote in a shape this fork cannot read is skipped, not crashed on', { concurrency: false }, async () => {
  await withHome(async ({ workspacePath, projectConfig }) => {
    await fs.mkdir(path.dirname(projectConfig), { recursive: true });
    await fs.writeFile(projectConfig, JSON.stringify({
      mcpServers: {
        'no-transport': { note: 'neither command nor serverUrl' },
        'not-an-object': 'nonsense',
        usable: { command: 'node' },
      },
    }, null, 2), 'utf8');

    const servers = await providerMcpService.listProviderMcpServersForScope('antigravity', 'project', { workspacePath });

    assert.deepEqual(servers.map((server) => server.name), ['usable']);
  });
});
