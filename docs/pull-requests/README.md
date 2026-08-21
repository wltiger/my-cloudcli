# Upstream Reports

Drafts of things reported (or considered for reporting) back to the official upstream repo, [`siteboon/claudecodeui`](https://github.com/siteboon/claudecodeui). Procedure and template: `docs/upstream-pr.md` (Chinese: `docs/upstream-pr.zh-CN.md`).

Entries are numbered locally and kept forever, including the ones that never ship — the duplicate check and verification work is reusable even when the answer is "don't submit".

**Standing bar for this fork: don't open an upstream report unless it's necessary.** Upstream's bottleneck is visibly review attention, not awareness — PRs #995, #1000 and #917 have sat open and unanswered since June–July 2026 — so every submission spends a scarce resource. The test that has actually decided these so far: *does this cost this fork anything?* A finding that upstream owns entirely, and that a fork customization already neutralises here, generally does not clear the bar.

| # | Title | Type | Status | Link |
|---|---|---|---|---|
| [PR01](PR01-vapid-subject-ios-push.md) ([中文](PR01-vapid-subject-ios-push.zh-CN.md)) | VAPID `sub` uses the reserved `.local` TLD, so APNs rejects every iOS push | Issue | Won't submit — costs this fork nothing (customization #10 fixes it here) | — |
| [PR02](PR02-file-tree-copy-path-double-toast.md) ([中文](PR02-file-tree-copy-path-double-toast.zh-CN.md)) | File tree "Copy Path" is dead on plain-HTTP LAN installs, and double-toasts on permission denial | PR | Won't submit — only bites plain-HTTP installs; fork already routes through the shared helper | — |
| [PR03](PR03-markdown-table-horizontal-scroll.md) ([中文](PR03-markdown-table-horizontal-scroll.zh-CN.md)) | Wide markdown tables compress instead of scrolling | PR | Won't submit — upstream just restyled these lines; the width bounds are untested tuning | — |
| [PR04](PR04-browser-runtime-install-directory.md) ([中文](PR04-browser-runtime-install-directory.zh-CN.md)) | Browser runtime installs where it is never resolved | — | Won't submit — already reported upstream (#995, #1000, #917) | — |
| [PR05](PR05-page-title-frozen-on-conversations-tab.md) ([中文](PR05-page-title-frozen-on-conversations-tab.zh-CN.md)) | Page title stops updating on the Conversations / Archive sidebar tabs | Issue | Won't submit — cosmetic, zero fork cost, needs an upstream design decision. **Duplicate check not run** | — |

## If you revive one of these

Re-verify before doing anything else. Every entry cites line numbers against a specific upstream commit (`677b7ba`, v1.37.2) — code moves. PR05 in particular never had its duplicate check run, because the decision not to submit came first; `docs/upstream-pr.md` requires that search before drafting.
