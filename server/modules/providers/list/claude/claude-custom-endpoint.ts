import type { ProviderModelsDefinition } from '@/shared/types.js';

export type ClaudeCustomEndpointEnv = {
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_API_KEY: string;
};

/**
 * Looks up whether `model` is a Claude custom model with its own Base
 * URL/API Key, using the same catalog-lookup pattern the runtime already
 * uses to resolve per-model effort. Returns null for every built-in model
 * and every plain custom model, leaving the SDK's environment untouched.
 */
export function resolveClaudeCustomEndpointEnv(
  model: string | undefined,
  modelsDefinition: ProviderModelsDefinition,
): ClaudeCustomEndpointEnv | null {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model);
  if (!selectedModel?.baseUrl || !selectedModel?.apiKey) {
    return null;
  }

  return {
    ANTHROPIC_BASE_URL: selectedModel.baseUrl,
    ANTHROPIC_API_KEY: selectedModel.apiKey,
  };
}
