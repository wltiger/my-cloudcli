import type { ProviderModelOption } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * A custom model's base URL and API key must be set together or not at all —
 * there is no useful state with only one of the two present. Used by
 * `provider-models.service.ts` when normalizing a create/update payload.
 */
export const assertCustomModelEndpointFieldsPaired = (
  baseUrl: string | undefined,
  apiKey: string | undefined,
): void => {
  if (Boolean(baseUrl) === Boolean(apiKey)) {
    return;
  }

  throw new AppError(
    baseUrl ? 'API Key is required when Base URL is set.' : 'Base URL is required when API Key is set.',
    {
      code: baseUrl ? 'MODEL_API_KEY_REQUIRED' : 'MODEL_BASE_URL_REQUIRED',
      statusCode: 400,
    },
  );
};

/**
 * Reasoning-effort levels Claude's own models are known to accept, in the
 * order the built-in catalog (`claude-models.provider.ts`) lists them.
 */
export const CUSTOM_MODEL_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * Rejects any level a custom model declares that isn't one CloudCLI knows how
 * to send to Claude. Used by `provider-models.service.ts` when normalizing a
 * create/update payload.
 */
export const assertValidEffortLevels = (levels: string[] | undefined): void => {
  const unknown = levels?.find((level) => !(CUSTOM_MODEL_EFFORT_LEVELS as readonly string[]).includes(level));
  if (!unknown) {
    return;
  }

  throw new AppError(`Unknown reasoning-effort level: ${unknown}.`, {
    code: 'MODEL_INVALID_EFFORT_LEVEL',
    statusCode: 400,
  });
};

/**
 * Builds the `effort` block a custom model's declared levels should expose in
 * its `ProviderModelOption`, picking "medium" as the default when offered and
 * otherwise the first declared level in canonical order. Used by
 * `provider-models.service.ts`'s `toCustomProviderModelOption`.
 */
export const buildCustomModelEffort = (
  effortLevels: string[] | null,
): ProviderModelOption['effort'] => {
  if (!effortLevels || effortLevels.length === 0) {
    return undefined;
  }

  const defaultLevel = effortLevels.includes('medium')
    ? 'medium'
    : CUSTOM_MODEL_EFFORT_LEVELS.find((level) => effortLevels.includes(level));

  return {
    default: defaultLevel,
    values: effortLevels.map((value) => ({ value })),
  };
};

/**
 * Smallest and largest context window a custom model may declare, expressed in
 * the K units the UI collects (K = 1024 tokens). A model whose real window is
 * larger than 1024K uses the `[1m]` name-suffix convention Claude Code already
 * recognises instead of a declaration.
 */
const CUSTOM_MODEL_CONTEXT_WINDOW_K_RANGE = { min: 1, max: 1024 } as const;

const TOKENS_PER_K = 1024;

/**
 * Rejects a context window that could not have come from a whole number of K
 * units inside the supported range. The API and the database carry raw tokens,
 * so the check is done on the K value the raw number implies. Used by
 * `provider-models.service.ts` when normalizing a create/update payload; an
 * absent declaration is always valid, and is valid with or without a custom
 * endpoint (the window belongs to the model name, not to the routing).
 */
export const assertValidContextWindow = (contextWindow: number | undefined): void => {
  if (contextWindow === undefined) {
    return;
  }

  const units = contextWindow / TOKENS_PER_K;
  const isWholeUnits = Number.isInteger(contextWindow) && Number.isInteger(units);
  if (
    isWholeUnits
    && units >= CUSTOM_MODEL_CONTEXT_WINDOW_K_RANGE.min
    && units <= CUSTOM_MODEL_CONTEXT_WINDOW_K_RANGE.max
  ) {
    return;
  }

  throw new AppError(
    `Context window must be a whole number of K (1024 tokens), between ${CUSTOM_MODEL_CONTEXT_WINDOW_K_RANGE.min}K and ${CUSTOM_MODEL_CONTEXT_WINDOW_K_RANGE.max}K.`,
    {
      code: 'MODEL_INVALID_CONTEXT_WINDOW',
      statusCode: 400,
    },
  );
};
