---
name: upstream-pr
description: Draft an issue or PR to report back to the official upstream repo (siteboon/claudecodeui) — a bug, a design gap, or a validated technical finding surfaced while working in this fork. Checks for duplicates, verifies claims against the current code, drafts title/body/rationale, and gets the maintainer's review before anything is actually submitted via gh. Use whenever something worth reporting to upstream comes up, including as the closing step of an `upstream-sync` sync.
---

Run this interactively in the main conversation — do not dispatch it to a background subagent. Drafting involves the maintainer challenging technical claims and asking for deeper verification; that back-and-forth needs them present, not a finished result handed back cold.

Follow `docs/upstream-pr.md` for the full template and procedure — do not improvise a submission from scratch. Chinese translation: `docs/upstream-pr.zh-CN.md`.

Never run `gh issue create` / `gh pr create` (or push a branch upstream) without the maintainer explicitly approving the drafted title, body, and rationale first.
