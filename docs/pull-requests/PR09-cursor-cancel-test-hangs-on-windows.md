# PR09: The test `cursor: a cancelled run is reported as stopped/aborted` never finishes on Windows, so `npm test` hangs

**Status:** Won't submit — this fork works around it with `--test-skip-pattern="cursor: a cancelled run"`, and the fix (how a test kills a fake CLI's process tree on Windows) is upstream's call (2026-11-09). Kept for the record.
**Type:** would have been an Issue
**Target:** `siteboon/claudecodeui`
**Found:** 2026-11-09, during this fork's sync to v1.37.8

## Duplicate check

Not run — the triage below ended it first. Run it before reviving this entry.

## Finding

Upstream `2053f3d7` (v1.37.8), `server/modules/providers/tests/provider-abort-notifications.test.ts`: `installFakeCli` writes a `.cmd` wrapper on Windows that runs `node <name>.cjs`, and the cancel case's fake CLI idles (`setInterval`) until it is killed. Aborting kills the `cmd.exe` wrapper but not the `node` child, so the run never settles and the test file never exits. Measured on Windows 11: the file alone times out after 150 s, the other four cases of the file pass when run by name, and a full `npm test` runs past 30 minutes until it is killed.

## Decision (2026-11-09)

Does not clear the bar in `docs/upstream-pr.md`: the cost here is a skip flag, and the fix needs a design choice (a process-tree kill in the test helper, or a non-wrapper fake CLI) that is upstream's. Revisit if the skip has to grow to more tests.
