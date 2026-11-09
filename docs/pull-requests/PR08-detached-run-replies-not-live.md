# PR08: A reply the server sends on its own (queued or scheduled message) does not stream to a tab that has the session open

**Status:** Won't submit — this fork already fixes it (customization #31, v1.37.8), the evidence is a code reading plus a unit test rather than a browser observation, and the fix reshapes upstream's run registry, which is their design call (2026-11-09). Kept for the record.
**Type:** would have been an Issue
**Target:** `siteboon/claudecodeui`
**Found:** 2026-11-09, during this fork's sync to v1.37.8

## Duplicate check

Not run — the triage below ended it first. Run it before reviving this entry.

## Finding

Upstream `2053f3d7` (v1.37.8): a tab attaches to a run only when it sends `chat.subscribe` (`chat-websocket.service.ts`, `chatRunRegistry.attachConnection`), and `chatRunRegistry.startRun` gives a new run only the connection that asked for it. `runDetachedChatTurn` — used by the queued-message and scheduled-message dispatcher — starts its run with `connection: null`. So a tab already showing the session is attached to nothing while that run streams, and the reply appears only after a reload or a reconnect (both re-subscribe). The same holds for a turn another tab started.

Not measured in a browser; read from code and pinned by this fork's `server/modules/websocket/tests/detached-runs.test.ts`.

## How this fork handles it

The registry keeps every socket that subscribed to a session (`watchSession`, called on `chat.subscribe`) and gives each new run that audience.

## Decision (2026-11-09)

Does not clear the bar in `docs/upstream-pr.md`: the fork is already fixed, the divergence is about 25 lines in two upstream files, and the evidence is inferred. Revisit if reapplying `watchSession` starts to conflict on every sync, or if a browser reproduction against an unmodified install is done.
