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

**Files:** `src/components/chat/utils/chatSpacing.ts`, `hooks/useChatSpacing.ts`, `view/subcomponents/ChatMessagesPane.tsx`, `MessageComponent.tsx`, `ToolGroupContainer.tsx`, `src/components/settings/hooks/useSettingsController.ts`, `settings/view/tabs/AppearanceSettingsTab.tsx`, `src/components/quick-settings-panel/view/QuickSettingsContent.tsx`, `ForkQuickSettings.tsx`, `QuickSettingsChatSpacingRow.tsx`

**Why:** Small phone screens waste space on the fixed horizontal padding around chat bubbles. Adds a Spacious/Compact/None setting (mobile-only), available from both the full Settings modal and the Quick Settings panel, sharing one `useChatSpacingLevel()` hook. Because the setting is a no-op above the `sm:` breakpoint, the Quick Settings row keeps a short note saying it only affects narrow screens — rather than hiding the row on desktop, which reads as the setting having disappeared. (Three iterations: the setting itself, a rename + Quick Settings integration, then the `ForkQuickSettings` extraction below — tracked as one customization.)

**On upstream conflict:** Keep mine. Pure opt-in setting, additive. In `QuickSettingsContent.tsx` the whole fork footprint is now two lines — a `ForkQuickSettings` import and a `<ForkQuickSettings />` appended as the panel body's last child. Every fork-added quick setting lives inside `ForkQuickSettings.tsx` (a file upstream doesn't have), so reapplying after a conflict means restoring those two lines and nothing else; do not push new rows back into upstream's own sections. All strings use `t(key, 'English default')` fallbacks on purpose — no `src/i18n/locales/**` edits, so translation files stay a zero-conflict surface.

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

## 10. Web Push VAPID subject that APNs accepts

**Files:** `server/modules/notifications/vapid-keys.service.ts`

**Why:** Upstream hardcodes `mailto:noreply@claudecodeui.local` as the VAPID `sub` claim. `.local` is a reserved TLD, and APNs validates that claim — it rejects every push with `403 BadJwtToken`, so **no iOS device has ever received a notification**. Verified against a live install with a real Home Screen web app subscription: same subscription, same keys, only the subject changed — `.local` → 403, `https://cloudcli.ai` → 201, a real `mailto:` → 201. Chrome's FCM and Mozilla's Autopush don't validate the domain, which is why the breakage is iOS-only and went unnoticed upstream.

**On upstream conflict:** Take upstream's version if they've fixed it themselves — any routable `mailto:`/`https:` value works, the specific string doesn't matter. Otherwise keep mine and reapply. This is a plain bug fix rather than a fork preference, so it's worth proposing upstream as a PR; once upstream ships an equivalent fix this entry can be dropped.

## 11. Fullscreen reading for chat messages and AskUserQuestion

**Files:** `src/shared/view/ui/FullscreenSurface.tsx` (new), `src/shared/view/ui/index.ts`, `src/components/chat/view/subcomponents/MessageFullscreenControl.tsx` (new), `src/components/chat/view/subcomponents/MessageComponent.tsx`, `src/components/chat/tools/components/InteractiveRenderers/AskUserQuestionPanel.tsx`, `src/i18n/locales/*/chat.json`

**Why:** On a phone the chat column is too narrow to read a long assistant message, and AskUserQuestion's option labels + descriptions get squeezed until you cannot tell the options apart — which defeats the point, since answering those prompts is exactly what you do away from the desk. One shared `FullscreenSurface` (portaled `inset-0` panel, Escape to close, body scroll lock, safe-area padding) backs both: a maximize button next to the message copy control, and one in the AskUserQuestion header (which also relaxes its `max-h-48` option list and bumps text sizes while expanded). Shown on desktop too — same code path, no breakpoint branch. Answering auto-exits fullscreen; the state is never persisted. The surface also carries the copy control in its header, a swipe-down-to-dismiss gesture (armed only while the body is scrolled to the top, so it never fights scrolling), and a `max-w-3xl` measure so lines stay scannable on a wide desktop. AskUserQuestion additionally pins its Skip/Back/Submit bar to the bottom of the viewport (via a `footer` slot on the surface — a `sticky` footer would be trapped by the card's own `overflow-hidden`) and titles the surface with the session name, threaded down as an optional `sessionTitle` on `PermissionPanelProps`.

**On upstream conflict:** Keep mine. `FullscreenSurface` is a new file with no upstream counterpart; the touch points in `MessageComponent.tsx` (one import + one entry in the footer control row) and `AskUserQuestionPanel.tsx` (state, header button, the `panel` variable + wrapper at the bottom, the `isFullscreen ?` class ternaries) are small and easy to reapply if upstream reworks either file.

## 12. Touch-reachable file tree menu + copy relative path

**Files:** `src/components/file-tree/view/FileContextMenu.tsx`, `FileTreeNode.tsx`, `FileTreeList.tsx`, `FileTreeBody.tsx`, `FileTree.tsx`, `src/components/file-tree/hooks/useFileTreeOperations.ts`, `utils/fileTreeUtils.ts`, `src/i18n/locales/*/common.json`

**Why:** Upstream mounts the file tree context menu on `onContextMenu` alone, so on a touch device the *entire* menu is unreachable — rename, delete, download, new file/folder, copy path. Two entry points are implemented on purpose so they can be compared on a real phone before deciding whether to drop one: a 500 ms long press (abandoned once the finger drifts >10 px, so scrolling still works) and a per-row `⋮` button rendered only below `md:`. Both drive the same menu state; `FileContextMenu` now also accepts a function child so a row can render its own trigger without owning that state. In detailed view the `⋮` takes over the permissions column on mobile, which was already too narrow to show `rw-rw-rw-` beside a button. Separately, a "Copy Relative Path" entry sits next to upstream's absolute "Copy Path" (two flat entries, no submenu), and both now go through the shared `copyTextToClipboard` util — upstream called `navigator.clipboard` directly and fired the success toast synchronously, so a failed copy showed "Failed to copy path" *and* "Path copied to clipboard".

**On upstream conflict:** Keep mine, but re-check the entry points first — if upstream has since added its own touch affordance, take theirs and drop whichever of the two duplicates it. The clipboard fix and the double-toast fix are plain bug fixes rather than fork preferences and are worth proposing upstream. Note this entry does edit `src/i18n/locales/*/common.json` (two keys inside upstream's existing `fileTree.context` block), unlike entry 3's deliberate `t(key, 'English default')`-only approach — the block is upstream's, so expect a small conflict there and reapply the two added keys.

## 13. Cross-project session switcher reachable from the chat title

**Files:** `src/lib/commandPaletteEvents.ts`, `src/components/command-palette/ForkRecentSessions.tsx`, `CommandPalette.tsx`, `src/components/main-content/view/subcomponents/MainContentTitle.tsx`, `src/utils/api.js`, `server/modules/providers/provider.routes.ts`, `services/sessions.service.ts`, `server/modules/database/repositories/sessions.db.ts`

**Why:** Upstream's command palette can already switch sessions, but its only trigger is Cmd/Ctrl+K — the sidebar's palette affordance is a `pointer-events-none` `<kbd>` badge hidden below `md:`. So on a phone the palette is unreachable and switching sessions means opening the sidebar. Tapping the chat title now opens the palette straight on its Sessions page, which also unlocks the palette's file/commit/branch search on touch devices. Upstream's Sessions group is scoped to the selected project (the same set the sidebar shows), so a fork-owned "Recent sessions (all projects)" group answers "what was I just in" regardless of project; it is deduped against the rows upstream already listed. Switching is just `navigate('/session/:id')` — the existing session resolver picks up the owning project, so cross-project needs no extra project-switch wiring. The backend gained `getRecentSessions(limit)` (`getAllSessions` is unordered and unbounded) plus `GET /api/providers/sessions/recent`; `sessions/running` could not be reused because it is deliberately status-only.

**On upstream conflict:** Keep mine. The upstream footprint is deliberately three small edits: one `useEffect` in `CommandPalette.tsx` listening for the fork's `cloudcli:open-command-palette` window event, one `<ForkRecentSessions />` element after upstream's Sessions group, and the chat title becoming a button in `MainContentTitle.tsx`. All the list, hook, and event code lives in fork-owned files, so reapplying means restoring those three spots. The window event exists precisely so the palette never needs a prop or a context handle; if upstream later adds its own external-open mechanism, drop the listener and call theirs. Strings use `t(key, 'English default')` fallbacks, no `src/i18n/locales/**` edits (same as entry 3). The row label falls back to the session id when a session has no stored name — a symptom of the naming problem tracked in #9, not of this entry.

## 14. Browser runtime installs into a managed directory

**Files:** `server/modules/browser-use/browser-use.service.ts`

**Why:** Upstream's `installRuntime()` runs `npm install --no-save --no-package-lock playwright` with `cwd: process.cwd()`, but `getPlaywright()` resolves `require('playwright')` from the module's own location. For a globally installed CloudCLI those are two different trees: the install lands in whatever directory the user happened to launch the CLI from (often the home directory), which node never walks into when resolving from `<npm root -g>/@cloudcli-ai/cloudcli/dist-server/server/modules/browser-use/`. So the install genuinely succeeds, the Settings tab still reports `Playwright: missing`, and the "Install Runtime" button looks like it does nothing no matter how often it is clicked — each click just reinstalls into the same unreachable place. Installing now targets `~/.cloudcli/browser-use/runtime` (beside the existing `profiles/` dir), seeded with a private `package.json` so npm does not walk up and adopt whatever project sits above it, and `getPlaywright()` tries the module's own resolution first and that directory second. `runCommand()` took a `cwd` argument for this. Dropping `--no-save --no-package-lock` is safe now that the manifest is fork-owned, and keeping the lockfile makes reinstalls cheaper.

**On upstream conflict:** This is a plain bug fix rather than a fork preference — worth proposing upstream, and drop this entry if they take it. Until then keep mine, but treat `installRuntime()` and `getPlaywright()` as a pair: they only work together, so if upstream rewrites either one, reapply both halves rather than merging one side and leaving the other. If upstream instead solves it by shipping playwright as a real dependency, drop this entirely — the first resolver already covers that case.

## 15. Tab switcher collapses into a menu on mobile

**Files:** `src/components/main-content/view/subcomponents/MainContentTabMenu.tsx`, `MainContentTabSwitcher.tsx`, `MainContentHeader.tsx`, `src/shared/view/ui/ActionMenu.tsx`

**Why:** Upstream puts the header title and the tab pills on one row. Below `lg:` the pills are already icon-only, but the count is not fixed — 4 built-ins plus optional Browser and Tasks plus one per enabled plugin — so on a 375px phone the strip takes ~148–220px and the title is left with under 150px (measured 51px with 6 tabs). Upstream's own mitigation, a horizontal scroller with gradient fade masks, stops the overflow but hands the title no width back. That costs more in this fork than upstream because entry 13 turned the chat title into the cross-project session switcher, so squeezing it also squeezes a navigation entry point. Below 768px — `isMobile`, the same flag the header already uses for the hamburger — the whole strip now collapses into one ~48px pill showing the active tab's icon plus a chevron; tapping it opens a dropdown listing every tab in the current order, divider before the plugin group, active row highlighted and marked `aria-current`. Measured title width went 51px → 217px. Desktop is untouched, scroller and fade masks included.

**On upstream conflict:** Keep mine. The upstream footprint is deliberately tiny and purely additive: one prop plus one early `return` in `MainContentTabSwitcher.tsx`, one prop pass-through in `MainContentHeader.tsx`, and four optional props on `ActionMenu` (`triggerIcon`, `showChevron`, item `iconNode`, item `isActive`) that its two existing call sites never set. All the menu code lives in the fork-owned `MainContentTabMenu.tsx`, so reapplying means restoring those spots. The early `return` sits *after* the tab list is built on purpose — both renderings share one list, so a built-in tab added upstream shows up in the mobile menu for free; keep that ordering when reapplying. The dropdown uses `ActionMenu`'s `portal` mode deliberately: the header's tab slot is `overflow-hidden` and would clip an absolutely-positioned menu, so if upstream restructures that wrapper, re-check the clipping before switching away from portal. Strings use `t(key, { defaultValue })`, no `src/i18n/locales/**` edits (same as entries 3 and 13). If upstream ships its own mobile tab affordance, take theirs and drop this.
