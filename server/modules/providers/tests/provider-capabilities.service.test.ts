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

// Seam: this is what the per-message Fork entry gates on. Codex must withhold
// it per ADR 0008 (docs/adr/0008-no-codex-rewind-or-fork.md); OpenCode forks
// through the same side channel Compact uses (#23).
test('Claude reports Fork support', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('claude').supportsFork, true);
});

test('Codex withholds Fork support (ADR 0008)', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('codex').supportsFork, false);
});

test('Cursor withholds Fork support for now', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('cursor').supportsFork, false);
});

test('OpenCode reports Fork support via the side channel (#23)', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('opencode').supportsFork, true);
});

test('the full capability list carries supportsFork for every provider', () => {
  const all = providerCapabilitiesService.listAllProviderCapabilities();
  assert.equal(all.length, 4);
  for (const capability of all) {
    assert.equal(typeof capability.supportsFork, 'boolean');
  }
});

// Seam: this is what the composer's Clear entry gates on. Clear reaches no
// provider API at all, so the flag records where it was verified (#24) rather
// than what a runtime can do -- Codex and Cursor are simply unverified.
test('Claude reports Clear support', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('claude').supportsClear, true);
});

test('OpenCode reports Clear support (#24)', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('opencode').supportsClear, true);
});

test('Codex withholds Clear support until it is verified', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('codex').supportsClear, false);
});

test('Cursor withholds Clear support until it is verified', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('cursor').supportsClear, false);
});

test('the full capability list carries supportsClear for every provider', () => {
  const all = providerCapabilitiesService.listAllProviderCapabilities();
  assert.equal(all.length, 4);
  for (const capability of all) {
    assert.equal(typeof capability.supportsClear, 'boolean');
  }
});

// Seam: this is what the per-message Rewind entry gates on. Only Claude has it
// so far (#25), through the SDK's own `resumeSessionAt`; OpenCode's `revert`
// lands in #26 and Codex never will (ADR 0008).
test('Claude reports Rewind support', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('claude').supportsRewind, true);
});

test('OpenCode withholds Rewind support until #26', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('opencode').supportsRewind, false);
});

test('Codex withholds Rewind support (ADR 0008)', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('codex').supportsRewind, false);
});

test('Cursor withholds Rewind support for now', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('cursor').supportsRewind, false);
});

test('the full capability list carries supportsRewind for every provider', () => {
  const all = providerCapabilitiesService.listAllProviderCapabilities();
  assert.equal(all.length, 4);
  for (const capability of all) {
    assert.equal(typeof capability.supportsRewind, 'boolean');
  }
});

// Fork and Rewind are two rules on the same provider, not one flag: OpenCode
// can fork today but cannot rewind until #26. Collapsing them would silently
// offer a Rewind that does nothing.
test('Fork and Rewind are tracked separately', () => {
  const opencode = providerCapabilitiesService.getProviderCapabilities('opencode');
  assert.equal(opencode.supportsFork, true);
  assert.equal(opencode.supportsRewind, false);
});
