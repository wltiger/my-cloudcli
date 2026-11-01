# PR07: Orphaned `opencode serve` processes are only reaped on Linux

**Status:** Won't submit — this fork behaves the same as upstream and carries no divergence here, OpenCode is little used on this machine, and the evidence comes from reading code only (2026-11-01). Kept for the record.
**Type:** would have been an Issue
**Target:** `siteboon/claudecodeui`
**Found:** 2026-11-01, in the final review of this fork's sync to v1.37.7

## Duplicate check

Not run — the triage below ended it first. Run it before reviving this entry.

## Finding

`server/modules/providers/list/opencode/opencode-runtime.provider.ts` (upstream `13e9ef64`, v1.37.7): each OpenCode turn starts its own `opencode serve`. `reapOrphanedOpenCodeServers` cleans up servers left behind by a CloudCLI that died, but it returns `0` straight away unless `process.platform === 'linux'`, because it walks `/proc`.

Expected effect on Windows and macOS: if CloudCLI is killed during a turn, that turn's server keeps running in the background, and a restart does not clean it up. The old `opencode run` runtime had no long-running server to leave behind.

Not measured: no reproduction was run. Also not checked: whether the server exits by itself on those platforms.

## Decision

Does not clear the bar in `docs/upstream-pr.md`: this fork's behaviour is identical to upstream's, so not reporting costs nothing here, and the evidence is inferred rather than measured.
