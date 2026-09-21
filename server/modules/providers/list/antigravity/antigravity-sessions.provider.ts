import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';

/**
 * Wiring stub. Transcript parsing and history fetch land in ticket #63.
 *
 * The optional fork / edit-anchor / rewind methods are deliberately absent:
 * ADR 0014 settles that `agy` cannot branch a conversation, and their
 * absence is what disables the corresponding UI.
 */
export class AntigravitySessionsProvider implements IProviderSessions {
  normalizeMessage(): NormalizedMessage[] {
    return [];
  }

  async fetchHistory(): Promise<FetchHistoryResult> {
    return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
  }
}
