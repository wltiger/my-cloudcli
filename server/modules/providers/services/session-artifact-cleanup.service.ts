import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider } from '@/shared/types.js';
import { readOptionalString } from '@/shared/utils.js';

/**
 * Deletes the files a provider's own CLI keeps for a session beyond its
 * transcript, for providers that have them
 * (`IProviderSessions.deleteProviderArtifacts`).
 *
 * The session row is deleted either way, so a failure is a warning and never a
 * failed delete. Resolves true when anything was removed.
 */
export async function deleteSessionArtifactsFromProvider(
  session: { session_id: string; provider: string; provider_session_id: string | null },
): Promise<boolean> {
  // A row created with the conversation id as its own id has no provider id.
  const providerSessionId = readOptionalString(session.provider_session_id) ?? session.session_id;

  try {
    return await providerRegistry
      .resolveProvider(session.provider as LLMProvider)
      .sessions.deleteProviderArtifacts?.(providerSessionId) ?? false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[${session.provider}] Could not delete the session's provider files:`, message);
    return false;
  }
}
