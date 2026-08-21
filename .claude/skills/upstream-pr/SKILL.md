---
name: upstream-pr
description: Decide whether a bug, design gap, or validated finding surfaced in this fork is worth reporting to the official upstream repo (siteboon/claudecodeui) — and draft it only if it clears a deliberately high bar. The default and most common outcome is a filed draft marked "won't submit", not a submission. Use whenever something looks worth reporting upstream, including as the closing step of an `upstream-sync` sync.
---

Run this interactively in the main conversation — do not dispatch it to a background subagent. Deciding involves the maintainer challenging technical claims and asking for deeper verification; that back-and-forth needs them present, not a finished result handed back cold.

**The bar is high on purpose, and the default answer is "don't submit."** Do not open with an assumption that a real finding should be reported. Run the triage in `docs/upstream-pr.md` ("Is this worth submitting at all?") *first* — before the duplicate check, before writing any draft. Severity to upstream's users is explicitly not sufficient on its own; a finding upstream owns entirely, that a fork customization already neutralises here, normally does not clear the bar no matter how bad it is for them. Report the triage verdict to the maintainer and let them decide; never talk them into submitting.

Follow `docs/upstream-pr.md` for the full bar, template, and procedure — do not improvise a submission from scratch. Chinese translation: `docs/upstream-pr.zh-CN.md`.

Findings that don't clear the bar still get written up and kept under `docs/pull-requests/` with `Status: Won't submit — {reason}`. That is a successful outcome of this skill, not a failure — the verification is reusable and it stops the next sync re-deriving it.

Never run `gh issue create` / `gh pr create` (or push a branch upstream) without the maintainer explicitly approving the drafted title, body, and rationale first.
