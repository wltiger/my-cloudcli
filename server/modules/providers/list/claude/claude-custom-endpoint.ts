import { readClaudeAgentPrompt } from '@/modules/providers/services/claude-agents.service.js';
import { readDeclaredContextWindow } from '@/modules/providers/services/claude-context-window.js';
import type { AnyRecord, ProviderModelsDefinition } from '@/shared/types.js';

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
 * environment untouched. Used by `claude-runtime.provider.ts`.
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

/**
 * Where a Claude custom model gets its system prompt when it replaces Claude
 * Code's default one: the name of an agent file in the global agents directory,
 * or the prompt text itself.
 */
export type ClaudeSystemPromptSource =
  | { kind: 'agent'; agent: string }
  | { kind: 'prompt'; prompt: string };

/**
 * Looks up the system prompt source `model` replaces the default prompt with,
 * using the same catalog lookup as {@link resolveClaudeCustomModelEnv}. Returns
 * null for the default prompt — every built-in model, and every custom model
 * with neither field. Used by `claude-runtime.provider.ts` for a turn (through
 * {@link applyClaudeSystemPromptSource}) and for a side question's fork. See
 * fork-customizations.md.
 */
export function resolveClaudeSystemPromptSource(
  model: string | undefined,
  modelsDefinition: ProviderModelsDefinition,
): ClaudeSystemPromptSource | null {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model);

  if (selectedModel?.systemPromptAgent) {
    return { kind: 'agent', agent: selectedModel.systemPromptAgent };
  }
  if (selectedModel?.systemPrompt) {
    return { kind: 'prompt', prompt: selectedModel.systemPrompt };
  }
  return null;
}

/**
 * Applies `model`'s system prompt source to a turn's SDK options, after the
 * default `claude_code` preset is already set: an agent rides in the SDK's
 * `agent` option next to that preset, a prompt text replaces the preset
 * outright. A model with no source leaves the options untouched. Used by
 * `mapCliOptionsToSDK` in `claude-runtime.provider.ts`.
 */
export function applyClaudeSystemPromptSource(
  sdkOptions: AnyRecord,
  model: string | undefined,
  modelsDefinition: ProviderModelsDefinition,
): void {
  const source = resolveClaudeSystemPromptSource(model, modelsDefinition);
  if (source?.kind === 'agent') {
    sdkOptions.agent = source.agent;
  } else if (source?.kind === 'prompt') {
    sdkOptions.systemPrompt = source.prompt;
  }
}

/**
 * Throws when a turn's mapped SDK options name an agent whose file is missing,
 * unreadable or empty. The CLI says nothing about an unknown `agent` — it runs
 * the turn on the default prompt, which the endpoint behind the model may
 * reject — so the runtime checks the file itself, with the same lookup the
 * side-question fork uses, and fails the turn instead of falling back. Options
 * with no agent (default and prompt models) pass without any file access. Used
 * by `queryClaudeSDK` in `claude-runtime.provider.ts`. See fork-customizations.md.
 */
export async function assertClaudeAgentReadable(sdkOptions: AnyRecord): Promise<void> {
  const agent = sdkOptions.agent;
  if (typeof agent !== 'string') {
    return;
  }
  if (await readClaudeAgentPrompt(agent) === null) {
    throw new Error(
      `Agent "${agent}" was not found, could not be read, or has an empty prompt. `
      + 'Pick another agent or fix the file in the model settings.',
    );
  }
}
