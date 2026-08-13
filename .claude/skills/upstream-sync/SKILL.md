---
name: upstream-sync
description: Sync this fork (wltiger/my-cloudcli) with the official upstream repo (siteboon/claudecodeui) — pulls upstream/main into main, merges main into dev, and resolves conflicts using this fork's own customization inventory. Use whenever the user asks to sync, merge, or pull in the latest official source, or to check whether an upstream change affects one of this fork's customizations.
---

Follow `docs/upstream-sync.md` for the full step-by-step procedure, and `docs/fork-customizations.md` for the inventory of what diverges from upstream, why, and how to resolve a conflict in each area. Do not improvise the merge from scratch — both files exist specifically so this doesn't have to be re-derived each time.

Chinese translations: `docs/upstream-sync.zh-CN.md`, `docs/fork-customizations.zh-CN.md`.

After a successful sync, review `docs/fork-customizations.md` for entries upstream may have made redundant (per that file's own "After a sync" section), and check whether anything found during the sync (a bug, a gap, a validated finding) is worth reporting to upstream — if so, use the `upstream-pr` skill rather than improvising a submission.
