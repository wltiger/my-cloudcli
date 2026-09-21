import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

/**
 * Wiring stub with no discovery roots. The real roots (CLI global, IDE
 * global, workspace, built-in) land in ticket #64.
 */
export class AntigravitySkillsProvider extends SkillsProvider {
  constructor() {
    super('antigravity');
  }

  protected async getSkillSources(): Promise<ProviderSkillSource[]> {
    return [];
  }
}
