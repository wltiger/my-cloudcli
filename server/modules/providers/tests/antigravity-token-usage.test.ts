/**
 * Antigravity's answer from the shared token-usage lookup.
 *
 * `agy`'s transcript records no token usage at all — the live turn is billed
 * from the stream's per-step usage instead — so a lookup that fell through to
 * the Claude transcript search answered every open session with a 404.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderTokenUsageService } from '@/modules/providers/services/provider-token-usage.service.js';

test('an Antigravity session reports token usage as unsupported instead of a missing file', async () => {
  const service = createProviderTokenUsageService({
    getSessionById: () => ({
      session_id: 'app-session',
      provider: 'antigravity',
      provider_session_id: 'ee37e759-6299-4424-921f-8dbbcc49e2ff',
      project_path: 'd:/code/project',
      jsonl_path: null,
      custom_name: null,
      model: null,
      effort: null,
      permission_mode: null,
      forked_from_session_id: null,
      external_running_at: null,
      isArchived: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    fileExists: () => false,
  });

  assert.deepEqual(await service.getSessionTokenUsage('app-session'), {
    used: 0,
    total: 0,
    inputTokens: 0,
    outputTokens: 0,
    breakdown: { input: 0, output: 0 },
    unsupported: true,
    message: 'Token usage tracking not available for Antigravity sessions',
  });
});
