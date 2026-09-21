import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

/**
 * Wiring stub. The scan of `agy`'s transcript files and the read-only
 * conversation index lands in ticket #63.
 */
export class AntigravitySessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(): Promise<number> {
    return 0;
  }

  async synchronizeFile(): Promise<string | null> {
    return null;
  }
}
