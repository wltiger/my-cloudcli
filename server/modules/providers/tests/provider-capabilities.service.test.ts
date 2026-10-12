import assert from 'node:assert/strict';
import test from 'node:test';

import { ANTIGRAVITY_PREDEFINED_MODELS } from '@/modules/providers/list/antigravity/antigravity-models.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { CODEX_PREDEFINED_MODELS } from '@/modules/providers/list/codex/codex-models.provider.js';
import { CURSOR_PREDEFINED_MODELS } from '@/modules/providers/list/cursor/cursor-models.provider.js';
import { OPENCODE_PREDEFINED_MODELS } from '@/modules/providers/list/opencode/opencode-models.provider.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import type { LLMProvider, ProviderModelsDefinition } from '@/shared/types.js';

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
  assert.equal(all.length, 5);
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
  assert.equal(all.length, 5);
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
  assert.equal(all.length, 5);
  for (const capability of all) {
    assert.equal(typeof capability.supportsClear, 'boolean');
  }
});

// Whether editing a message also puts tracked files back is settled by the
// provider, never offered as a choice. It is a flag of its own rather than an
// assumption folded into supportsMessageEditing, because the notice above the
// composer has to say which of the two it is before the reader commits.
test('only OpenCode rolls files back when a message is edited', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('opencode').rewindRestoresFiles, true);
  assert.equal(providerCapabilitiesService.getProviderCapabilities('claude').rewindRestoresFiles, false);
});

// Antigravity is the fifth provider, and every count above is hardcoded on
// purpose: adding a provider without deciding what it can do has to break a
// test rather than quietly inherit someone else's answers.
test('Antigravity appears in the full capability list (#60)', () => {
  const all = providerCapabilitiesService.listAllProviderCapabilities();
  assert.equal(all.filter((capability) => capability.provider === 'antigravity').length, 1);
});

// Seam: this is what the composer's permission-mode control offers. Headless
// `agy` accepts `--mode accept-edits` and `--mode plan` and then ignores them
// with a warning, so offering either would be a control that does nothing.
test('Antigravity offers only the two permission modes that do something (ADR 0015)', () => {
  const capabilities = providerCapabilitiesService.getProviderCapabilities('antigravity');

  assert.deepEqual(capabilities.permissionModes, ['default', 'bypassPermissions']);
  assert.equal(capabilities.defaultPermissionMode, 'default');
});

// Headless `agy` cannot prompt at all: a turn whose every tool call was refused
// still exits 0 and reports success. Pre-granting is the only lever, so the
// live permission-request path must never be offered.
test('Antigravity withholds live permission requests (ADR 0015)', () => {
  assert.equal(
    providerCapabilitiesService.getProviderCapabilities('antigravity').supportsPermissionRequests,
    false,
  );
});

test('Antigravity withholds Compact — the CLI has no /compact at all', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('antigravity').supportsCompact, false);
});

// ADR 0014: /rewind and /fork exist only as TUI overlays, so neither the Fork
// entry nor the per-message edit affordance may appear.
test('Antigravity withholds Fork, message editing and session forking (ADR 0014)', () => {
  const capabilities = providerCapabilitiesService.getProviderCapabilities('antigravity');

  assert.equal(capabilities.supportsFork, false);
  assert.equal(capabilities.supportsMessageEditing, false);
  assert.equal(capabilities.supportsSessionForking, false);
  assert.equal(capabilities.rewindRestoresFiles, false);
});

// Reasoning effort is baked into the model id (`-high`/`-medium`/`-low`), so it
// is expressed by choosing a model rather than by a Reasoning dial.
test('Antigravity withholds the effort control but reports token usage', () => {
  const capabilities = providerCapabilitiesService.getProviderCapabilities('antigravity');

  assert.equal(capabilities.supportsEffort, false);
  assert.equal(capabilities.supportsTokenUsage, true);
});

test('Antigravity accepts attachments and can be aborted', () => {
  const capabilities = providerCapabilitiesService.getProviderCapabilities('antigravity');

  assert.equal(capabilities.supportsImages, true);
  assert.equal(capabilities.supportsFiles, true);
  assert.equal(capabilities.supportsAbort, true);
  assert.equal(capabilities.supportsClear, true);
});

/**
 * The full curated catalogs, before OpenCode narrows its list to the upstream
 * providers a machine has connected.
 */
const CURATED_CATALOGS: Record<LLMProvider, ProviderModelsDefinition> = {
  claude: CLAUDE_PREDEFINED_MODELS,
  codex: CODEX_PREDEFINED_MODELS,
  cursor: CURSOR_PREDEFINED_MODELS,
  opencode: OPENCODE_PREDEFINED_MODELS,
  antigravity: ANTIGRAVITY_PREDEFINED_MODELS,
};

test('capability effort levels cover every level a curated model declares', () => {
  // Custom models may declare only these levels, so a level added to a curated
  // model has to be added here too, or users could not give it to their own.
  for (const [provider, catalog] of Object.entries(CURATED_CATALOGS) as Array<[LLMProvider, ProviderModelsDefinition]>) {
    const { effortLevels, supportsEffort } = providerCapabilitiesService.getProviderCapabilities(provider);

    assert.equal(supportsEffort, effortLevels.length > 0, `${provider}: supportsEffort disagrees with effortLevels`);
    assert.equal(new Set(effortLevels).size, effortLevels.length, `${provider}: effortLevels lists a level twice`);

    const declaredLevels = new Set(
      catalog.OPTIONS.flatMap((option) => option.effort?.values.map((level) => level.value) ?? []),
    );
    const missingLevels = [...declaredLevels].filter((level) => !effortLevels.includes(level));
    assert.deepEqual(missingLevels, [], `${provider}: effortLevels misses curated levels`);
  }
});
