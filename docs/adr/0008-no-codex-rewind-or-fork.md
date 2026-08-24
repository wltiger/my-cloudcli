# No Codex rewind or fork

Codex's app-server protocol carries `thread/fork` with `lastTurnId`/`beforeTurnId` — exactly the branch-at-a-point shape Rewind and Fork need — but its generated schema marks the companion operation `DEPRECATED: thread/rollback will be removed soon`, and rollback takes `numTurns` counted from the end rather than a message id, which is a different gesture from the one Claude and OpenCode share. `@openai/codex-sdk` 0.147.0, which the Codex runtime drives, exposes neither. Rewind and Fork are not offered for Codex sessions.

**Consequences**: this narrows ADR 0004's note that adopting app-server is "still the way to do this if it is revisited" — moving the Codex runtime onto app-server would buy Fork and Compact, but not Rewind.
