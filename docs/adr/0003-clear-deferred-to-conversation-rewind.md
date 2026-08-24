---
Status: superseded by ADR-0005
---

# Clear is deferred to conversation rewind rather than built as its own command

In every provider CloudCLI supports, "clear the conversation" is implemented as starting a new session, not as emptying the current one: Claude Code's `/clear` opens a fresh transcript under a new session id and leaves the previous one intact (verified against both a headless run and this machine's real transcripts, where every recorded `/clear` sits at the head of a new file with the whole subsequent conversation after it). Because CloudCLI discovers sessions from those transcripts, passing `/clear` through would leave a permanently empty extra session in the sidebar each time. Rewind is the operation that actually stays in place — resuming with `resumeSessionAt` truncates the conversation at a chosen message while keeping the same session id and the same transcript file. Clear is the limiting case of Rewind, so it is designed and shipped with the Rewind feature, sharing its per-message UI and its backend parameter; whether a rewind can reach a genuinely empty conversation rather than one that retains the first exchange is part of that design.

**Considered Options**: passing `/clear` through to the provider — rejected, it creates an empty throwaway session in the sidebar on every use and hands the frontend a mid-session session-id switch to reconcile. Aliasing `/clear` to the existing "new session" action — rejected, it renames a button that already exists and would have to be unbuilt once Rewind lands. Rewinding to the first message as a standalone Clear — rejected, it leaves the first exchange in context, so it does not actually clear.
