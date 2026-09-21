import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const notImplemented = (operation: string): AppError =>
  new AppError(`Antigravity MCP ${operation} are not available yet.`, {
    code: 'ANTIGRAVITY_MCP_NOT_IMPLEMENTED',
    statusCode: 501,
  });

/**
 * Wiring stub. The scopes and transports are declared up front — global
 * (the config shared with the Antigravity IDE) and workspace, with one
 * remote field covering both http and sse; the actual `mcp_config.json`
 * read/write lands in ticket #64. Reads report an empty set so the UI lists
 * nothing rather than erroring.
 */
export class AntigravityMcpProvider extends McpProvider {
  constructor() {
    super('antigravity', ['user', 'project'], ['stdio', 'http', 'sse']);
  }

  protected async readScopedServers(): Promise<Record<string, unknown>> {
    return {};
  }

  protected async writeScopedServers(): Promise<void> {
    throw notImplemented('writes');
  }

  protected buildServerConfig(): Record<string, unknown> {
    throw notImplemented('writes');
  }

  protected normalizeServerConfig(): ProviderMcpServer | null {
    throw notImplemented('reads');
  }
}
