import type { IProviderRuntime } from '@/shared/interfaces.js';
import { AppError } from '@/shared/utils.js';

const notImplemented = (operation: string): AppError =>
  new AppError(`Antigravity ${operation} are not available yet.`, {
    code: 'ANTIGRAVITY_NOT_IMPLEMENTED',
    statusCode: 501,
  });

/**
 * Wiring stub. The headless `agy -p --output-format stream-json` runtime
 * lands in ticket #62; until then the auth stub reports the CLI as not
 * installed, so the UI never starts an Antigravity turn.
 */
export const antigravityRuntime: IProviderRuntime = {
  async run(): Promise<unknown> {
    throw notImplemented('runs');
  },

  async abort(): Promise<boolean> {
    return false;
  },
};
