import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

/**
 * Stable wiring stub: reports the CLI as not installed so the provider stays
 * hidden from the New Session picker. The version probe and sign-in
 * detection land in ticket #62.
 */
export class AntigravityProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    return {
      installed: false,
      provider: 'antigravity',
      authenticated: false,
      email: null,
      method: null,
      error: 'Antigravity CLI not installed',
    };
  }
}
