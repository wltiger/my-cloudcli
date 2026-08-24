import type { LLMProvider } from '@/shared/types.js';

/**
 * Static, backend-owned description of what one provider integration supports.
 *
 * The frontend renders its composer UI (permission mode picker, image upload,
 * abort button, ...) purely from this shape, which is what keeps the frontend
 * free of per-provider conditionals. New provider features should be exposed
 * here instead of branching on the provider id in React components.
 */
type ProviderCapabilities = {
  provider: LLMProvider;
  /** Permission modes the provider runtime understands, in cycle order. */
  permissionModes: string[];
  defaultPermissionMode: string;
  /** Whether image attachments can be included in a chat.send. */
  supportsImages: boolean;
  /** Whether general file attachments can be included in a chat.send. */
  supportsFiles: boolean;
  /** Whether an in-flight run can be cancelled via chat.abort. */
  supportsAbort: boolean;
  /** Whether interactive tool permission prompts can reach the UI. */
  supportsPermissionRequests: boolean;
  /** Whether the token-usage endpoint has data for this provider. */
  supportsTokenUsage: boolean;
  /** Whether the provider runtime can accept model-level reasoning effort. */
  supportsEffort: boolean;
  /** Whether the provider can run Compact (`/compact`) to shrink a session's context. */
  supportsCompact: boolean;
  /** Whether a message's Anchor can be Forked into a new session. */
  supportsFork: boolean;
  /** Whether the open conversation can be Cleared: archived, and replaced by an empty session. */
  supportsClear: boolean;
  /** Whether an earlier message can be re-sent to Rewind the session back to that point. */
  supportsRewind: boolean;
  /**
   * Whether that Rewind also restores tracked files to their state at that
   * point. Settled by the provider rather than chosen per Rewind (see the
   * Rewind entry in `CONTEXT.md`): it exists so the notice above the composer
   * can say so before the reader commits, not as a toggle.
   */
  rewindRestoresFiles: boolean;
};

/**
 * The capability matrix mirrors what each runtime actually implements today:
 * - permission modes match the option sets accepted by each CLI/SDK.
 * - only the Claude SDK integration surfaces interactive permission requests.
 * - Cursor has no token usage endpoint support (its store.db has no usage rows).
 * - Claude and OpenCode support Compact; see ADR 0004 for why Codex does not,
 *   and issue #21 for OpenCode's side-channel implementation. Cursor is
 *   unsupported — not investigated.
 * - Claude and OpenCode support Fork; see ADR 0008 for why Codex never will,
 *   and issue #23 for OpenCode's own, which forks through the same side channel
 *   Compact uses. Cursor is unsupported — not investigated.
 * - Claude and OpenCode support Rewind — Claude through the SDK's own
 *   `resumeSessionAt` (#25), OpenCode through the `revert` its HTTP API
 *   exposes (#26). Codex never will (ADR 0008), and Cursor is unsupported —
 *   not investigated. Only OpenCode's restores tracked files with the
 *   conversation, because that is the only shape its API has.
 * - Clear reaches no provider API at all (ADR 0005), so the flag records which
 *   providers it was verified on — Claude and OpenCode (#24) — rather than what
 *   a runtime can do. Codex and Cursor are simply unverified.
 */
const PROVIDER_CAPABILITIES: Record<LLMProvider, ProviderCapabilities> = {
  claude: {
    provider: 'claude',
    permissionModes: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: true,
    supportsTokenUsage: true,
    supportsEffort: true,
    supportsCompact: true,
    supportsFork: true,
    supportsClear: true,
    supportsRewind: true,
    rewindRestoresFiles: false,
  },
  cursor: {
    provider: 'cursor',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: false,
    supportsEffort: false,
    supportsCompact: false,
    supportsFork: false,
    supportsClear: false,
    supportsRewind: false,
    rewindRestoresFiles: false,
  },
  codex: {
    provider: 'codex',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
    supportsCompact: false,
    supportsFork: false,
    supportsClear: false,
    supportsRewind: false,
    rewindRestoresFiles: false,
  },
  opencode: {
    provider: 'opencode',
    // Mapped by the runtime onto OpenCode's controls: `--agent plan` (plan),
    // `--auto` (bypassPermissions) and the OPENCODE_PERMISSION env var
    // (acceptEdits). See resolveOpenCodePermissionOptions in the OpenCode runtime adapter.
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
    supportsCompact: true,
    supportsFork: true,
    supportsClear: true,
    supportsRewind: true,
    rewindRestoresFiles: true,
  },
};

/**
 * Application service exposing the provider capability matrix.
 */
export const providerCapabilitiesService = {
  getProviderCapabilities(provider: LLMProvider): ProviderCapabilities {
    return PROVIDER_CAPABILITIES[provider];
  },

  listAllProviderCapabilities(): ProviderCapabilities[] {
    return Object.values(PROVIDER_CAPABILITIES);
  },
};
