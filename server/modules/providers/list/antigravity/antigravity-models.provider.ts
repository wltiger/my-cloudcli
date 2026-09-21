import type { IProviderModels } from '@/shared/interfaces.js';
import type { ProviderCurrentActiveModel, ProviderModelsDefinition } from '@/shared/types.js';

/**
 * Wiring stub with an empty catalog. The static catalog, the background
 * live-list merge, and the active-model read-back land in ticket #62.
 */
export class AntigravityProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return { OPTIONS: [], DEFAULT: '' };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return { model: '' };
  }
}
