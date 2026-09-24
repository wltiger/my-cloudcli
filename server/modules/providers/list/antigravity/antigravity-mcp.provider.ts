import os from 'node:os';
import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  writeJsonConfig,
} from '@/shared/utils.js';

/**
 * Scope -> agy native config file. `user` is the config `agy` shares with the
 * Antigravity IDE; `project` is the workspace-local config. There is no
 * provider-local ("local") scope for `agy`.
 */
const resolveConfigPath = (scope: McpScope, workspacePath: string): string => (
  scope === 'user'
    ? path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json')
    : path.join(workspacePath, '.agents', 'mcp_config.json')
);

export class AntigravityMcpProvider extends McpProvider {
  constructor() {
    super('antigravity', ['user', 'project'], ['stdio', 'http', 'sse']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const filePath = resolveConfigPath(scope, workspacePath);
    const config = await readJsonConfig(filePath);
    return readObjectRecord(config.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = resolveConfigPath(scope, workspacePath);
    const config = await readJsonConfig(filePath);
    config.mcpServers = servers;
    await writeJsonConfig(filePath, config);
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      return {
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
        cwd: input.cwd,
        disabled: false,
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http/sse MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    // agy has one field for both remote transports; http and sse are not
    // distinguishable on disk, so reading either back always normalizes to 'http'.
    return {
      serverUrl: input.url,
      headers: input.headers ?? {},
      disabled: false,
    };
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) {
      return null;
    }

    if (typeof config.command === 'string') {
      return {
        provider: 'antigravity',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
        cwd: readOptionalString(config.cwd),
      };
    }

    if (typeof config.serverUrl === 'string') {
      return {
        provider: 'antigravity',
        name,
        scope,
        transport: 'http',
        url: config.serverUrl,
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
