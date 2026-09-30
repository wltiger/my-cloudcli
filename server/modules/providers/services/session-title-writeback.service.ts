import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * Passes a session's new name to the provider's own title store, for providers
 * whose CLI has one (`IProviderSessions.writeSessionTitle`).
 *
 * The session is already renamed when this runs, so a failure is a warning and
 * never a failed rename; the provider's title then wins again at its next sync.
 */
export function writeSessionTitleToProvider(
  session: { provider: string; provider_session_id: string | null },
  title: string,
): void {
  if (!session.provider_session_id) {
    return;
  }

  try {
    providerRegistry
      .resolveProvider(session.provider as LLMProvider)
      .sessions.writeSessionTitle?.(session.provider_session_id, title);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[${session.provider}] Could not write the session title to the provider:`, message);
  }
}
