import { watchHeldTurns } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';

/**
 * Connects the Claude runtime's held-process lifecycle to the run registry's
 * background-work-outstanding state.
 *
 * Imported for its effect by this module's barrel, so the two are wired together
 * wherever the chat gateway is — the server itself and any test that reaches for
 * the registry — rather than only in a start-up path a test would have to
 * reproduce.
 *
 * The subscription lives on this side because the dependency runs one way: the
 * websocket module already knows about providers, and having the provider write
 * into the registry directly closed a module-initialisation cycle
 * (providers → websocket → projects → providers) that left the provider registry
 * half-built.
 */
watchHeldTurns((sessionId, outstanding) => {
  chatRunRegistry.setBackgroundWorkOutstanding(sessionId, outstanding);
});
