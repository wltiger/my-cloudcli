import { readDeclaredContextWindow } from '@/modules/providers/services/claude-context-window.js';
import type { ProviderModelsDefinition } from '@/shared/types.js';

/**
 * Environment a Claude custom model needs the spawned CLI to run with. Every
 * key is optional on its own: a model may route to its own endpoint, declare
 * its own context window, or do both.
 */
export type ClaudeCustomModelEnv = {
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_CODE_MAX_CONTEXT_TOKENS?: string;
};

/**
 * Builds the environment overrides `model` needs, using the same catalog-lookup
 * pattern the runtime already uses to resolve per-model effort. Returns null
 * when the model asks for nothing — every built-in model, and every custom
 * model with neither an endpoint nor a declared window — leaving the SDK's
 * environment untouched. Used by `claude-runtime.provider.js`.
 */
export function resolveClaudeCustomModelEnv(
  model: string | undefined,
  modelsDefinition: ProviderModelsDefinition,
): ClaudeCustomModelEnv | null {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model);
  const env: ClaudeCustomModelEnv = {};

  if (selectedModel?.baseUrl && selectedModel?.apiKey) {
    env.ANTHROPIC_BASE_URL = selectedModel.baseUrl;
    env.ANTHROPIC_API_KEY = selectedModel.apiKey;
  }

  // Claude Code honours this only for model names it does not recognise, which
  // is exactly the class a declaration exists for; a recognised name that
  // carries one surfaces as the runtime's mismatch warning, not as an error.
  const declaredContextWindow = readDeclaredContextWindow(model, modelsDefinition);
  if (declaredContextWindow) {
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(declaredContextWindow);
  }

  return Object.keys(env).length > 0 ? env : null;
}
