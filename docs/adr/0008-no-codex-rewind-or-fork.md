---
Status: superseded (v1.37.3) — upstream took the app-server route this record named as the way back in, and Codex now has both Fork and Edit.
---

# No Codex rewind or fork

Codex's app-server protocol carries `thread/fork` with `lastTurnId`/`beforeTurnId` — exactly the branch-at-a-point shape Rewind and Fork need — but its generated schema marks the companion operation `DEPRECATED: thread/rollback will be removed soon`, and rollback takes `numTurns` counted from the end rather than a message id, which is a different gesture from the one Claude and OpenCode share. `@openai/codex-sdk` 0.147.0, which the Codex runtime drives, exposes neither. Rewind and Fork are not offered for Codex sessions.

**Consequences**: this narrows ADR 0004's note that adopting app-server is "still the way to do this if it is revisited" — moving the Codex runtime onto app-server would buy Fork and Compact, but not Rewind.

**Superseded by upstream taking exactly that route.** v1.37.3 spoke `codex app-server` and reached `thread/fork`, the operation named in the first line above — `codex-fork.provider.ts` for Fork, and `CodexSessionsProvider.rewindSession` for Edit. So the prediction held on its main point and was wrong on its narrowing: `thread/fork` bought the rewind-shaped capability too, because an edit is performed by forking the thread and repointing the session row at the copy rather than by the deprecated `thread/rollback` this record was measuring. What was actually unavailable was the counted-from-the-end rollback, not branch-at-a-point; once the branch is taken through the fork operation, the deprecation this record turned on stops applying. Codex sessions now offer both.
