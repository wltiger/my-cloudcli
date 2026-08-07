# Fork Customizations

**This fork:** [`wltiger/my-cloudcli`](https://github.com/wltiger/my-cloudcli) (`origin` remote). **Upstream:** [`siteboon/claudecodeui`](https://github.com/siteboon/claudecodeui) (`upstream` remote). `main` tracks `upstream/main` as a clean mirror; all work in this fork — including everything below — lives on `dev`. Full remote/branch/sync setup: `docs/agents/issue-tracker.md`. Step-by-step sync procedure: `docs/upstream-sync.md`.

A living inventory of behavior in this fork (`wltiger/my-cloudcli`) that deliberately diverges from upstream (`siteboon/claudecodeui`). When syncing `upstream/main` and a merge conflict (or a suspicious silent behavior change) lands on one of the files listed below, check the matching entry here before deciding whether to keep this fork's version, reapply it on top of upstream's new code, or drop it because upstream solved the same problem natively.

This is not a TODO list — see the repo's issue tracker (`docs/agents/issue-tracker.md`) for open follow-up work. This file only tracks *that a divergence exists and why*.

## 1. Compact mobile sidebar

**Files:** `src/constants/config.ts`, `src/components/sidebar/view/subcomponents/SidebarFooter.tsx`, `SidebarHeader.tsx`, `SidebarContent.tsx`

**Why:** Hides the mobile Report Issue/Discord links and moves the Settings entry point to a tap on the mobile header title, freeing vertical space for the project list.

**On upstream conflict:** Keep mine. Opt-in via `VITE_COMPACT_MOBILE_SIDEBAR` (default off), wraps existing code in conditionals rather than replacing it — low conflict surface. Reapply the conditional branches around whatever upstream changed.

## 2. Sidebar favorites filter

**Files:** `src/components/sidebar/utils/utils.ts`, `hooks/useSidebarController.ts`, `view/Sidebar.tsx`, `view/subcomponents/SidebarContent.tsx`, `SidebarHeader.tsx`, `src/components/settings/hooks/useSettingsController.ts`

**Why:** With enough auto-discovered projects the sidebar gets unwieldy; a star-icon toggle filters the Projects tab down to Starred-only, remembered across sessions.

**On upstream conflict:** Keep mine. Note: the `useSettingsController.ts` change also fixed a real bug (saving settings used to overwrite the whole `claude-settings` blob, silently dropping keys it doesn't own) — that fix is a general correctness improvement, not fork-specific preference; worth proposing upstream separately if convenient.

## 3. Chat message spacing setting

**Files:** `src/components/chat/utils/chatSpacing.ts`, `hooks/useChatSpacing.ts`, `view/subcomponents/ChatMessagesPane.tsx`, `MessageComponent.tsx`, `ToolGroupContainer.tsx`, `src/components/settings/hooks/useSettingsController.ts`, `settings/view/tabs/AppearanceSettingsTab.tsx`, `src/components/quick-settings-panel/view/QuickSettingsContent.tsx`, `QuickSettingsChatSpacingRow.tsx`

**Why:** Small phone screens waste space on the fixed horizontal padding around chat bubbles. Adds a Spacious/Compact/None setting (mobile-only), available from both the full Settings modal and the Quick Settings panel, sharing one `useChatSpacingLevel()` hook. (Two iterations: the setting itself, then a rename + Quick Settings integration — tracked as one customization.)

**On upstream conflict:** Keep mine. Pure opt-in setting, additive.

## 4. Model label prettification + wider selector

**Files:** `src/components/chat/view/subcomponents/ComposerModelMenu.tsx`, `chat/utils/modelLabel.ts` (+ test)

**Why:** A model set via the Claude Code CLI directly (not CloudCLI's own switcher) showed a raw, sometimes-truncated internal model id instead of a readable name.

**On upstream conflict:** Keep mine, but re-read `docs/adr/0001-strict-model-label-fallback.md` first if upstream ships something in this area — it specifically rejected fuzzy/substring matching in favor of strict-pattern-or-raw-fallback; compare approaches rather than assuming mine still wins.

## 5. Offline-capable app shell (service worker cache-first) ⚠️ re-evaluate, don't blindly keep

**Files:** `public/sw.js`, `src/components/settings/view/tabs/AboutTab.tsx`

**Why:** CloudCLI ships PWA infrastructure but didn't actually work offline — the service worker deliberately never cached the HTML/JS shell, and the server sends `no-cache` on HTML specifically "to prevent service worker issues." This fork reverses that decision: cache-first app shell + a manual "Refresh offline cache" control, no automatic staleness detection.

**On upstream conflict:** **Highest-priority re-check in this list.** This directly reverses an intentional upstream design choice. If upstream ever touches `public/sw.js` or the `Cache-Control` headers in `server/index.ts`, re-read `docs/adr/0002-cache-first-app-shell-manual-refresh.md` before reapplying — upstream may have addressed the exact staleness failure mode that made them avoid this in the first place, which would change the tradeoff.

## 6. PWA / title name unified to "CloudCLI"

**Files:** `index.html`, `public/manifest.json`, `src/utils/pageTitleNotification.ts`, `src/components/sidebar/view/subcomponents/SidebarProjectList.tsx`

**Why:** Three different strings existed for the app name ("CloudCLI UI" in the manifest/title, "Claude UI" in the iOS meta tag) — unified to "CloudCLI", the product's current name.

**On upstream conflict:** Keep mine, but check first — if upstream also unifies its own naming, this customization may become fully redundant and can just be dropped.

## 7. Remember last session on PWA reopen

**Files:** `src/hooks/useDeviceSettings.ts`, `src/hooks/useProjectsState.ts`

**Why:** An installed PWA always launches into `manifest.json`'s `start_url` ("/"), landing on the empty project picker instead of wherever the user left off.

**On upstream conflict:** Keep mine. Opt-in via `display-mode: standalone` detection — a plain browser tab is unaffected.

## 8. Version display: build git SHA + timestamp

**Files:** `vite.config.js`, `src/vite-env.d.ts`, `src/components/settings/view/tabs/AboutTab.tsx`, `server/index.ts`

**Why:** With the offline cache-first shell (#5) it became hard to tell whether a running instance is a fresh build or a stale cached one. Shows the build's git SHA + timestamp next to the version badge, front and back.

**On upstream conflict:** Keep mine. Deliberately never touches `package.json`'s `version` field (kept identical to upstream, which owns that field) — designed specifically to have near-zero conflict surface.

## 9. `.claude/` tracked selectively (CLAUDE.md + skills/)

**Files:** `.gitignore`

**Why:** Upstream ignores `.claude/` entirely. This fork carves out exceptions for `.claude/CLAUDE.md` (this repo's Claude Code guidance — see this file's own intro for why it lives there instead of a root `CLAUDE.md`, which upstream's `.gitignore` also excludes) and `.claude/skills/` (project-scoped Claude Code skills, e.g. `sync-upstream`), so both travel with the fork instead of being local-only. Everything else under `.claude/` (`settings.local.json`, etc.) stays ignored — genuinely personal/local state.

**On upstream conflict:** Keep mine. If upstream adds new patterns to the same `# AI specific` block, reapply the two negation lines (`!.claude/CLAUDE.md`, `!.claude/skills/` + `!.claude/skills/**`) *after* every pattern that could match those paths — gitignore re-inclusion only wins over rules earlier in the file, and the existing bare `CLAUDE.md` rule matches `.claude/CLAUDE.md` too if the negation isn't placed after it.
