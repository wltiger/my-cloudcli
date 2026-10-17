import { providerModelsDb } from '@/modules/database/index.js';
import type { ProviderModelsDefinition } from '@/shared/types.js';

/**
 * Context window the readout assumes when nothing else says otherwise. Kept at
 * the value the server-level `CONTEXT_WINDOW` variable has always defaulted to,
 * so an install that declares nothing behaves exactly as before.
 */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 160_000;

/**
 * The context window one Claude session's usage readout should show, in raw
 * tokens: the model's own declaration first, then the window the SDK reported
 * for the session, then the operator's server-level `CONTEXT_WINDOW` variable,
 * then the 160K default.
 *
 * Every read point goes through this one function — the runtime's live turn
 * budget (`claude-runtime.provider.js`), the token-usage aggregation
 * (`provider-token-usage.service.ts`) and the session-history read
 * (`claude-sessions.provider.ts`) — so re-reading a session can never make the
 * number jump between the declared value and the server-level one.
 *
 * `configured` is a parameter rather than a direct environment read so the
 * token-usage service can keep injecting it the way it already does; callers
 * with nothing to inject let it default. Named fields, not positions, so a
 * swapped number cannot pass silently.
 */
export function resolveContextWindowTotal({
  declared,
  reported,
  configured = process.env.CONTEXT_WINDOW,
}: {
  declared?: number | null;
  reported?: number | null;
  configured?: string | undefined;
}): number {
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) {
    return declared;
  }
  if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) {
    return reported;
  }

  const parsed = Number.parseInt(configured ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONTEXT_WINDOW_TOKENS;
}

/**
 * Declared window for the selected model, read out of a catalog the caller
 * already holds. Used by `claude-runtime.provider.js`, which loads the provider
 * catalog once per turn — the same lookup shape `resolveClaudeEffort` and
 * `resolveClaudeCustomModelEnv` use. Returns null for every built-in model and
 * every custom model that declares nothing.
 */
export function readDeclaredContextWindow(
  model: string | undefined,
  modelsDefinition: ProviderModelsDefinition,
): number | null {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model);
  return selectedModel?.contextWindow ?? null;
}

/**
 * Declared window for a model named on a stored session row, for read points
 * that have a model name but no catalog in hand:
 * `provider-token-usage.service.ts` and, through it,
 * `claude-sessions.provider.ts`.
 *
 * Reads the custom-model table directly rather than the merged catalog, because
 * only custom rows can carry a declaration. A database that is not reachable
 * yet (or has no such row) simply reports no declaration, leaving the caller on
 * the server-level fallback instead of failing a history read.
 */
export function lookupDeclaredContextWindow(model: string | null | undefined): number | null {
  if (!model) {
    return null;
  }

  try {
    return providerModelsDb.findCustomProviderModelByModelId('claude', model)?.contextWindow ?? null;
  } catch {
    return null;
  }
}
