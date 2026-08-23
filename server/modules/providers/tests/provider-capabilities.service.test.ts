import assert from 'node:assert/strict';
import test from 'node:test';

import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';

// Seam: this is what the completion menu and the token-usage panel button
// actually gate on. Claude must offer Compact; Codex must withhold it per
// ADR 0004 (docs/adr/0004-no-codex-compact-via-sdk.md).
test('Claude reports Compact support', () => {
  const capabilities = providerCapabilitiesService.getProviderCapabilities('claude');
  assert.equal(capabilities.supportsCompact, true);
});

test('Codex withholds Compact support (ADR 0004)', () => {
  const capabilities = providerCapabilitiesService.getProviderCapabilities('codex');
  assert.equal(capabilities.supportsCompact, false);
});

test('OpenCode reports Compact support via the side channel (#21)', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('opencode').supportsCompact, true);
});

test('Cursor withholds Compact support for now', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('cursor').supportsCompact, false);
});

test('the full capability list carries supportsCompact for every provider', () => {
  const all = providerCapabilitiesService.listAllProviderCapabilities();
  assert.equal(all.length, 4);
  for (const capability of all) {
    assert.equal(typeof capability.supportsCompact, 'boolean');
  }
});
