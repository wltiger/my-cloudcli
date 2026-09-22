import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

export class AntigravitySkillsProvider extends SkillsProvider {
  constructor() {
    super('antigravity');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    return [
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.agents', 'skills'),
        commandPrefix: '/',
      },
      // Which global root the CLI actually scans is unconfirmed (only the IDE
      // root was observed populated) — both candidates are returned until
      // that is settled, rather than picking one.
      {
        scope: 'user',
        rootDir: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'skills'),
        commandPrefix: '/',
      },
      {
        scope: 'user',
        rootDir: path.join(os.homedir(), '.gemini', 'config', 'skills'),
        commandPrefix: '/',
      },
    ];
  }
}
