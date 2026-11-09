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
  /**
   * Whether re-running the conversation from an edited message also restores
   * tracked files to their state at that point. Settled by the provider rather
   * than chosen per edit: it exists so the notice above the composer can say
   * so before the reader commits, not as a toggle.
   */
  rewindRestoresFiles: boolean;
  /**
   * Reasoning-effort levels the runtime can pass on, weakest first, and so the
   * levels a custom model-library entry may declare. Empty exactly when
   * `supportsEffort` is false. Covers every level a predefined model declares
   * (a providers test enforces this) and, unlike the model catalog, does not
   * depend on which upstream providers this machine has connected.
   */
  effortLevels: string[];
  /**
   * Whether an already-sent message can be replaced, which requires the
   * provider to re-run a conversation truncated at a chosen point.
   */
  supportsMessageEditing: boolean;
  /**
   * Whether a session's transcript can be branched into an independent one.
   */
  supportsSessionForking: boolean;
  /**
   * Whether the provider can answer a question on the side without touching
   * the session's main turn. False only for Cursor, which has no headless
   * way to do that.
   */
  supportsSideQuestions: boolean;
  /**
   * Whether a message can be sent into a running turn (`chat.steer`), which the
   * model reads at its next tool-call boundary without the turn stopping.
   * Requires a runtime that keeps its CLI's input open during a turn.
   */
  supportsSteering: boolean;
};

/**
 * The capability matrix mirrors what each runtime actually implements today:
 * - permission modes match the option sets accepted by each CLI/SDK.
 * - the Claude and OpenCode SDK integrations surface interactive permission
 *   requests (and the agent's questions); Cursor and Codex run without them.
 * - Cursor has no token usage endpoint support (its store.db has no usage rows).
 * - Claude supports Compact; see ADR 0004 for why Codex does not. OpenCode's
 *   Compact, Fork and Edit were retired at the v1.37.7 sync (upstream's SDK
 *   runtime replaced the runtime they were built on) until its v2 rework.
 *   Cursor is unsupported — not investigated.
 * - `supportsFork` is this fork's own per-message flag, true for Claude only.
 *   Codex reaches Fork through upstream's `supportsSessionForking` instead
 *   (ADR 0008 is superseded).
 * - No provider's edit restores tracked files today: Claude's
 *   `resumeSessionAt` and Codex's `thread/fork` leave the working tree alone.
 * - Clear reaches no provider API at all (ADR 0005), so the flag records which
 *   providers it was verified on — Claude and OpenCode (#24) — rather than what
 *   a runtime can do. Codex and Cursor are simply unverified.
 * - Antigravity: headless print mode cannot prompt for permission, so only
 *   default and bypassPermissions are offered (ADR 0015); its /rewind and /fork
 *   are TUI-only overlays, so Fork and Edit are unavailable (ADR 0014); it has
 *   no /compact command, and reasoning effort is baked into the model id rather
 *   than a runtime flag.
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
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    supportsCompact: true,
    supportsFork: true,
    supportsClear: true,
    rewindRestoresFiles: false,
    // `resumeSessionAt` re-runs a conversation truncated at a message, and
    // `forkSession` copies a transcript prefix into a new session file.
    supportsMessageEditing: true,
    supportsSessionForking: true,
    supportsSideQuestions: true,
    // Streaming input stays open for the whole run, and a user message written
    // to it with priority `next` joins the running turn.
    supportsSteering: true,
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
    effortLevels: [],
    supportsCompact: false,
    supportsFork: false,
    supportsClear: false,
    rewindRestoresFiles: false,
    supportsMessageEditing: false,
    supportsSessionForking: false,
    supportsSideQuestions: false,
    supportsSteering: false,
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
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    supportsCompact: false,
    supportsFork: false,
    supportsClear: false,
    rewindRestoresFiles: false,
    // Not from the Codex SDK, which only starts and resumes threads: both ride
    // the same CLI's `app-server` protocol, whose `thread/fork` copies a
    // thread up to a chosen turn. Editing is that fork plus a new prompt,
    // which is how Codex's own IDE clients do it.
    supportsMessageEditing: true,
    supportsSessionForking: true,
    supportsSideQuestions: true,
    supportsSteering: false,
  },
  opencode: {
    provider: 'opencode',
    // Mapped by the runtime onto OpenCode's controls: the `plan` agent (plan),
    // and its answers to OpenCode's permission requests — every request
    // approved once (bypassPermissions), file edits approved once
    // (acceptEdits), or the chat asked (default). See
    // resolveAutomaticPermissionReply in the OpenCode runtime adapter.
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: true,
    supportsTokenUsage: true,
    supportsEffort: true,
    // Passed on as OpenCode's model `variant`. `thinking` (MiniMax's on/off
    // variant, paired with `none`) is not a strength, so it sorts last.
    effortLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'thinking'],
    supportsCompact: false,
    supportsFork: false,
    supportsClear: true,
    rewindRestoresFiles: false,
    supportsMessageEditing: false,
    supportsSessionForking: false,
    supportsSideQuestions: true,
    supportsSteering: false,
  },
  antigravity: {
    provider: 'antigravity',
    // ADR 0015: accept-edits and plan are accepted in print mode and then
    // ignored with a warning, so only the two modes that do something are listed.
    permissionModes: ['default', 'bypassPermissions'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    // Headless `agy` cannot prompt at all (ADR 0015): a fully refused run still
    // exits 0 and reports success — the only signal is the refused-action list.
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    // Reasoning effort is baked into the model id and not uniform across
    // models, so it is expressed by choosing a model; the effort flag is never
    // passed.
    supportsEffort: false,
    effortLevels: [],
    // `agy` has no /compact command; its compaction is internal and untriggerable.
    supportsCompact: false,
    // ADR 0014: /rewind and /fork exist only as TUI overlays.
    supportsFork: false,
    supportsClear: true,
    rewindRestoresFiles: false,
    supportsMessageEditing: false,
    supportsSessionForking: false,
    // The agy runtime has neither an `askSideQuestion` nor a `steer` facet.
    supportsSideQuestions: false,
    supportsSteering: false,
  },
};

/**
 * Application service exposing the provider capability matrix. Used by the
 * Providers routes (the capabilities endpoints) and by the Providers model
 * service, which reads `effortLevels` to validate custom-model effort.
 */
export const providerCapabilitiesService = {
  getProviderCapabilities(provider: LLMProvider): ProviderCapabilities {
    return PROVIDER_CAPABILITIES[provider];
  },

  listAllProviderCapabilities(): ProviderCapabilities[] {
    return Object.values(PROVIDER_CAPABILITIES);
  },
};
