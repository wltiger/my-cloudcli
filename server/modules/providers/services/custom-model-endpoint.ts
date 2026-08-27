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
