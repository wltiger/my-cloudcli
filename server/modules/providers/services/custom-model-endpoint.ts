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
