# PR06: Each new turn releases the held Claude process, so background work cannot survive a follow-up turn

**Status:** Won't submit — upstream's release-per-turn is a deliberate design; a report would ask them to reverse it
**Type:** would have been an Issue
**Target:** `siteboon/claudecodeui`
**Found:** 2026-10-18, while syncing this fork to v1.37.5 — from the merge conflict, not from a bug report

## Duplicate check

Not run. The decision not to submit came before the duplicate check, so this entry is a triage record, not a submission-ready draft. Anyone reviving it must run the duplicate search first (`docs/upstream-pr.md`, "Before drafting anything").

## Background

Upstream v1.37.5 (`0ce5630f`) calls `releaseHeldSession(sessionKey())` at the start of every turn, so the Claude process that holds a session's background work is always released. This fork keeps that process open and feeds a follow-up turn into it when the turn fingerprint matches (customization #29, claim-and-push). The v1.37.5 merge kept the fork's reuse path and moved upstream's release onto the interrupt path only. Every sync has to resolve this by hand, which is why it is recorded here.

## Evidence

- Direct code trace: `server/modules/providers/list/claude/claude-runtime.provider.js:1011` at `upstream/main` (`0ce5630f`) runs `releaseHeldSession(sessionKey());` for every turn, guarded only by `if (sessionKey())`. The comment at lines 1008–1009 says: "A new turn supersedes any earlier one still holding this session's process open, so held runs cannot stack up across a conversation."
- Direct code trace: `src/modules/chat/hooks/useChatComposerState.ts:938` at `upstream/main` asks the user before an interactive send when background work exists.
- Interpretation, not measured: upstream treats "a new turn ends background work" as intended. The pre-send prompt is the evidence I used. I did not search upstream issues or design notes for it.

## Decision (2026-10-18)

Won't submit. One part of the cost test holds: the divergence is painful to reapply on every sync. The deciding limb is the other one: the fix this fork needs would require upstream to reverse a deliberate design decision (their comment and composer prompt both describe the stop). `docs/upstream-pr.md` says a report must not need a design decision from upstream.

Revisit if upstream changes the per-turn release, or adds a way to keep background work across turns. Then this divergence could be proposed as a retirement of customization #29.
