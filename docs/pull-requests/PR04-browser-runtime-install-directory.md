# PR04: Browser runtime installs where it is never resolved

**Status:** Won't submit — already reported upstream, three times, all still open
**Type:** — (would have been a PR)
**Target:** `siteboon/claudecodeui`
**Found:** 2026-08-21 duplicate check, during the v1.37.2 sync (the underlying finding predates it — see fork customization #14)

## Duplicate check

This is the whole content of this entry. Searched `siteboon/claudecodeui` (2026-08-21):

- PRs `playwright install` → **#995**, **#1000**, **#917**
- PRs `browser runtime` → **#995**, **#917**
- PRs `install runtime` → **#1000**, **#917**
- PRs `browser use` → **#995**, **#1000**, **#917**, plus #889 (the merged PR that added the feature) and #921 (unrelated noVNC viewer)
- issues, all four phrasings → nothing

Read in full:

| PR | Opened | State | What it proposes |
|---|---|---|---|
| [#995](https://github.com/siteboon/claudecodeui/pull/995) — `fix: install browser runtime outside process cwd` | 2026-07-11 | Open | Install into `~/.cloudcli/browser-use/runtime`; resolve the packaged dependency first, then that directory; run npm from the same directory; pin Playwright 1.61.1; keeps the Windows `npm.cmd` handling; adds tests. |
| [#1000](https://github.com/siteboon/claudecodeui/pull/1000) — `fix(browser): install Playwright runtime in package dir, not cwd` | 2026-07-11 | Open | Same root cause, same diagnosis (`runCommand`'s `cwd: process.cwd()` vs `createRequire(import.meta.url)` resolution), installs into the package dir instead. |
| [#917](https://github.com/siteboon/claudecodeui/pull/917) — `Fix Windows browser-runtime install and Claude Code SDK spawn failures` | 2026-06-24 | Open | Three Windows-only failures including this one; also fixes `spawn EINVAL` on `npm.cmd` with `shell: false`. |

**#995 is functionally identical to this fork's customization #14** — same `~/.cloudcli/browser-use/runtime` directory, same "resolve the packaged dependency first, then the runtime directory" ordering. It was raised by a different contributor who explicitly refreshed #917's version against main.

No maintainer has responded on any of the three. The only human comment across all of them is on #917, from the author of #995 cross-referencing his own PR. The rest is CodeRabbit bot output.

## Verified still broken at upstream HEAD

Confirmed against `677b7ba` (v1.37.2), so the three PRs are still relevant, not stale:

- `server/modules/browser-use/browser-use.service.ts` line 247 — `runCommand()` spawns with `cwd: process.cwd()`
- lines 141–147 — `getPlaywright()` is `require('playwright')` via `createRequire(import.meta.url)`, i.e. resolved from the module's own location
- line 305 — `installRuntime()` runs `npm install --no-save --no-package-lock playwright` through that `runCommand`

For a globally-installed CloudCLI launched from any directory other than the install tree, those are two different places, so the install succeeds and the Settings tab still reports Playwright as missing.

v1.37.2 did touch this file — but only to extract `getBrowserUseRuntime()` into `browser-use-runtime.ts`. The install/resolve mismatch was not addressed.

## Decision

**Don't submit.** A fourth report of a bug that already has three open PRs — one of them proposing the exact same fix as this fork's — adds noise, not information. The bottleneck upstream is review attention, not awareness.

Keep fork customization #14 as-is. On a future sync, if any of #995 / #1000 / #917 merges, take upstream's version and retire #14 (its "on conflict" note already says to drop the entry if upstream solves it — that note should now name these PR numbers so the next sync doesn't re-derive this).

Reconsider only if all three get closed unmerged **and** the bug is still present — at that point a fresh issue asking *why* would be a different contribution from a fourth duplicate PR.

## Open questions

1. Agreed on not submitting?
2. Worth adding a short "me too / still reproducible on v1.37.2" comment on #995 to signal the bug is still live, or does that count as noise too?
