# Implementing the Antigravity (`agy`) provider — build guide

Audience: an agent or engineer implementing provider #5 (`antigravity`) in this repo.
Companion document: **`docs/antigravity-agy-provider-feasibility.md`** — the research this guide is
distilled from. Read this file to *build*; read that file to check *why* a claim holds, or to see the raw
evidence behind any fact repeated here.

**Prerequisite gate — do not start without it.** Antigravity's ToS §6 forbids "using third party software,
tools, or services to access the Service." The feasibility doc argues at length that this targets credential
borrowing (the OpenClaw ban wave) rather than front-ends driving the official CLI, and downgrades the risk
to "acceptable for the self-hosted single-user shape." That is a **maintainer decision that must be recorded
before code lands**, and it carries one hard constraint that survives into the design:

> **A hosted, multi-user deployment funnelling many users through one Antigravity account is out of bounds.**
> Quota is per-account and weekly; that is the exact load pattern Google acted on.

---

## Decisions already taken — read these first

The plan was settled in a grilling session on 2026-09-21, before any code was written. None of the
following is an open question, and several of them **overrule the raw research this guide was distilled
from**:

- **`docs/adr/0013-wrapping-the-antigravity-cli-is-in-bounds-borrowing-its-credentials-is-not.md`** —
  the prerequisite gate above, now closed. Scope is self-hosted single-user; re-evaluate before
  proposing the provider upstream.
- **`docs/adr/0014-antigravity-has-no-fork-and-no-edit-because-its-rewind-is-a-tui-overlay.md`** —
  `/rewind` and `/fork` exist but are TUI-only. Do not spend a turn rediscovering this.
- **`docs/adr/0015-antigravity-permissions-are-granted-in-the-users-own-project-record.md`** — grants
  live in the user's own Antigravity project record, selected with `--project`.

Also settled: upstream-owned files are edited in **upstream's own style**, not routed around, because
this fork may propose the provider upstream later — so no fork-only indirection to dodge merge
conflicts. The `provider_models` `CHECK` list is widened and backed by an idempotent rebuild migration
(a `CREATE TABLE IF NOT EXISTS` will not alter an existing table), with the merge rule recorded in
`docs/fork-customizations.md`. Delivery is one branch in six staged commits: wiring, runtime + models +
auth, sessions + synchronizer, mcp + skills, permissions, docs + i18n. `CONTEXT.md` now defines
**Antigravity project** — `agy`'s own named record — as distinct from CloudCLI's **Project**; never use
"project" bare for the former.

### Corrections to the research — all verified on `agy` 1.2.7, 2026-09-21

| The research said | Actually |
| --- | --- |
| `--mode accept-edits|plan` is a usable option | Accepted, then **ignored in print mode** with a warning |
| Slash commands are expanded in print mode | Only read-only ones (`/help`, `/config`, `/permissions`, `/hooks`, `/changelog`). `/fork` and `/rewind` reach the model as literal text — one test run burned 42k tokens proving it |
| Compaction might be CLI-triggerable | There is **no `/compact`**. Closed |
| `--add-dir` is the project key | `--project` is. `--add-dir` only adds workspace roots |
| Permissions live in `settings.json` | They live in `~/.gemini/config/projects/<id>.json` under `permissionGrants`, and global grants are **cleared** when the named project carries none. Matching is exact: `command(echo)` does not cover `echo hello` |
| A denied tool fails the run | Exit code is **0** and `result.status` is `"SUCCESS"`. The only signal is an empty `response` plus a populated `denied_actions` |
| `result.usage` / `duration_seconds` / `num_turns` describe the call | They are **conversation-cumulative** on a resumed conversation. Per-step `usage` is the per-call number |
| `AGY_CLI_INTERACTIVE_HEADLESS` might enable prompts | It does not |

---

## Evidence labels

Everything below is labelled so you know how much to trust it:

- **[V]** — verified on a real machine (`agy` 1.2.7, Windows 11) during the research pass
- **[D]** — first-party documentation (`antigravity.google`) or first-party source (the Apache-2.0 Python SDK)
- **[?]** — unknown or unconfirmed; **you must resolve this empirically before relying on it** (see §13)

`agy` moves fast — 50 releases between 1.0.0 and 1.2.6. Re-verify any **[V]** fact that your implementation
depends on, against the version you pin (§1).

---

## 0. Read these first, in this order

1. `server/modules/providers/README.md` — the facet contract, file layout, wrapper template, and the
   canonical list of files to update. It is kept current on purpose; this guide does not duplicate it.
2. `server/shared/interfaces.ts` — the seven facet interfaces and their doc comments.
3. `.agents/skills/backend-module-standards/SKILL.md` — auto-loaded for any `server/` work per `AGENTS.md`.
   Module boundaries are lint **errors**, not style nits.
4. `server/modules/providers/list/opencode/**` — the closest structural analogue to `agy` (local process +
   per-session JSONL + a SQLite index shared with the CLI itself).

---

## 1. Ground rules

These are hard constraints discovered during research. Violating any of them produces a subtly broken
provider rather than a compile error.

| # | Rule | Why |
| --- | --- | --- |
| 1 | **Always pass `--project <id>`**, with `--add-dir <projectPath>` alongside it. | [V] `--project` is what attributes the conversation *and* the only scope in which a permission grant applies (ADR 0015) — `cli.log` logs `ApplyProjectPermissionGrants: stored N allow ... from project "<id>"`. `--add-dir` only adds workspace roots. Without either, `workspace_uris` is empty: 30 of 33 pre-existing CLI conversations on the test machine were unattributable for exactly this reason. |
| 2 | **Set `AGY_CLI_DISABLE_AUTO_UPDATE` on the spawned child only.** | [V] `agy` self-updates by default and its surface changes between patch releases. Set it on CloudCLI's own process, never globally — the user's terminal `agy` should keep updating. By decision there is **no version gate**: warn only on a major-version jump (1.x to 2.x), otherwise run and let it fail loudly. |
| 3 | **Never write to or delete `~/.gemini/antigravity-cli/conversation_summaries.db`.** | [V] It is shared with the Antigravity IDE (63 of 96 rows on the test machine were IDE rows). Read-only, always filtered to `app_data_dir = 'antigravity-cli'`. This is the same rule `opencode-session-synchronizer.provider.ts` already follows via `jsonl_path: null`. |
| 4 | **Never read, store or forward Antigravity OAuth tokens.** | They live in the OS keyring; `agy` owns them. Touching them is the exact pattern ToS §6 prohibits. |
| 5 | **Key transcript records on `(conversation_id, step_index)`, never line number.** | [V] `status: "RUNNING"` rows exist and a step is re-emitted when it transitions to `DONE`. Upsert, don't append. |
| 6 | **Assume `transcript.jsonl` can be rewritten under you.** | [V] Context compaction rewrites the file; first-party release notes record a bug where a concurrent append left malformed JSON. A byte-offset tail must be able to fall back to a full re-read. |
| 7 | **New backend files are TypeScript**, cross-module imports go through barrels, tests live in `server/modules/providers/tests/`. | `.agents/skills/backend-module-standards/SKILL.md`; enforced by oxlint. |

---

## 2. Files to create

All new, all fork-owned, **zero upstream merge risk** — upstream has no `list/antigravity/` path.

```
server/modules/providers/list/antigravity/
├── antigravity.provider.ts                        # ~30 lines, copy opencode.provider.ts
├── antigravity-runtime.provider.ts                # the big one
├── antigravity-sessions.provider.ts               # the second big one
├── antigravity-session-synchronizer.provider.ts
├── antigravity-models.provider.ts
├── antigravity-auth.provider.ts
├── antigravity-mcp.provider.ts
└── antigravity-skills.provider.ts
src/shared/ui/AntigravityLogo.tsx                  # ~25 lines, copy the opencode logo component
server/modules/providers/tests/antigravity-*.test.ts
```

Size expectation, from measuring the four existing providers: **cursor totals 1,638 lines and opencode
~2,980** (excluding its test). `sessions` is the largest file in every provider (654–2,267 lines);
`runtime` is second (387–921).

---

## 3. Facet: `runtime` — hardest, but `agy` makes it easier than average

Interface: `IProviderRuntime` (`server/shared/interfaces.ts:31-40`) — `run(command, options, writer, context)`
and `abort(sessionId)`; optional `permissions` gateway.
No shared base class exists. Start from `cursor-runtime.provider.js` (387 lines — the thinnest spawn +
stdout-stream implementation) and borrow abort/process-tree teardown from
`opencode-runtime.provider.js` (`killOpenCodeProcessTree`, `:186`).

### Invocation

```bash
agy -p "<prompt>" \
    --output-format stream-json \
    --project <antigravity-project-id> \
    --add-dir <projectPath> \
    [--conversation <uuid>] \
    [--model <id>] [--effort low|medium|high] \
    [--dangerously-skip-permissions] [--sandbox]
```

- `--input-format stream-json` (requires `--output-format stream-json`) turns stdin into a driver loop:
  one NDJSON message per line, one turn each, conversation stays open, closing stdin ends it. [V]
  Input shape: `{"event":"user","message":{"content":"..."}}` where `content` is a string or an array of
  blocks — **only `type: "text"` blocks are accepted; anything else terminates the session with an error.** [D]
- `--conversation <uuid>` resumes; `step_index` continues from where it left off and `usage` accumulates. [V]
- `--print-timeout 0` waits until the turn completes (the default). [V]

### Output events (NDJSON on stdout) [V]

```jsonc
{"event":"init","conversation_id":"<uuid>","init":{"cwd":"...","tools":[...56 names...],"permission_mode":"request-review"}}
{"event":"step_update","step_update":{"conversation_id":"<uuid>","step_index":0,"state":"DONE","step_type":"user_input"}}
{"event":"step_update","step_update":{"conversation_id":"<uuid>","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"ok"}}
{"event":"step_update","step_update":{"conversation_id":"<uuid>","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"\n","duration_seconds":1.357,"usage":{"input_tokens":13503,"output_tokens":49,"thinking_tokens":48,"cache_read_tokens":0,"total_tokens":13552}}}
{"event":"result","result":{"conversation_id":"<uuid>","status":"SUCCESS","response":"ok\n","duration_seconds":1.630,"num_turns":1,"usage":{...},"denied_actions":[...]}}
```

Documented vocabulary [D]: events `init` | `step_update` | `result`. `step_update` fields:
`conversation_id`, `step_index`, `state` (`ACTIVE`/`DONE`), `step_type` (`user_input`, `agent_response`,
`tool`, `checkpoint`), `tool_name`, `text_delta`, `duration_seconds`, `usage`, `tool_info`, `subagent_info`.
`result.status` ∈ {`SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`, `INVALID`, `WAITING`, `RUNNING`}.

> **The docs' `step_type` list is not exhaustive on 1.2.7** — `system_message` was observed in practice. [V]
> Handle unknown `step_type` values by passing them through as generic text rather than throwing.

### Use the official Python SDK as your spec

The SDK (`Google-Antigravity/antigravity-sdk-python`, **Apache-2.0**) is one-way compatible into this repo's
`AGPL-3.0-or-later` licence — you may **port** code, keeping the Apache copyright/NOTICE and marking
modifications. Its transport differs (protobuf over a local WebSocket to a bundled `localharness` binary,
not NDJSON on stdout), so **wire-level code does not transfer — state machines and enums do.**

| SDK artifact | Use it for |
| --- | --- |
| `google/antigravity/proto/localharness.proto` (842 lines) | Canonical enums. `StepUpdate.State` = `UNSPECIFIED/ACTIVE/DONE/WAITING_FOR_USER/ERROR`; `StepUpdate.Source` = `SYSTEM/USER/MODEL`; `TrajectoryStateUpdate.State` = `RUNNING/FULLY_IDLE/CANCELLED/WAITING_FOR_TASKS`; `StopReason` includes `QUOTA_EXHAUSTED` and the max-model-call / max-tool-call / max-token variants. The CLI emits these names with the `STATE_`/`SOURCE_` prefix stripped. **This is how you get exhaustive handling instead of guessing.** |
| `connections/local/event_processor.py` | The delta-folding state machine: dedup by `step_index`, re-emission across state transitions, partial-text accumulation. This is exactly what your normalizer needs. Port it. |
| `connections/local/local_connection.py` | Child-process lifecycle: spawn, readiness handshake, stderr pump, graceful shutdown escalating through `subprocess.TimeoutExpired` (`:625-629`). |
| `examples/getting_started/*.py` (34 files) | Runnable specs for `cancellation`, `compaction`, `streaming`, `budget_limits`, `policies`, `human_in_the_loop`, `slash_commands`, `mcp_tools`, `agent_skills`, `subagents`. |

### Permissions — the part that does not map cleanly

Documented modes: `request-review`, `proceed-in-sandbox`, `always-proceed`, `strict` (settings key
`toolPermission`) [D]. Flags: `--mode accept-edits|plan`, `--dangerously-skip-permissions`, `--sandbox` [V].

**Observed headless behaviour, and the reason this is the biggest remaining design risk:** tools needing
permission are **soft-denied**. The run still **exits 0**, and the denial is reported only in
`result.denied_actions` (e.g. `[{"action":"command","display_name":"RunCommand"}]`), with a stderr notice
naming the allow-rule that would have been needed. [V] There is no interactive permission prompt on the
stream to hook into.

That does not line up with CloudCLI's interactive permission UX. Recommended MVP resolution: set
`supportsPermissionRequests: false` in the capability matrix (cursor already ships this way), surface
`denied_actions` to the user as a post-turn notice, and record the decision as an ADR. Allow-rules go under
`permissions.allow` in `agy`'s settings using patterns like `command(git)`, `read_file(path)`,
`write_file(src/)` [D][V].

### Abort

Signal-driven: kill the child process. `result.status` carries `CANCELED` / `INTERRUPTED`; closing stdin
ends a streaming session gracefully. **There is no `agy cancel <id>` subcommand.** [V] Same mechanism as the
existing codex/cursor runtimes — reuse opencode's process-tree teardown on Windows.

### Errors

On agent/model API failure the CLI prints a structured `AGY_ERROR: {...}` JSON line on **stderr**
(canonical status, HTTP/gRPC code, retryability, error id) and exits **3**. [V] Parse it; don't treat
non-zero exit as opaque.

### Not available

- **No Node SDK.** The official SDK is Python-only; npm has no first-party package (`antigravity-sdk@1.7.0`
  on npm is an unrelated AGPL community package for IDE extensions). Subprocess is the only path — which is
  how codex, cursor and opencode already work here. Only the Claude provider uses an SDK.
- **No native image/file attachment blocks in headless mode.** `stream-json` input accepts `text` blocks
  only [D] — which is why attachments ride the shared `<images_input>`/`<files_input>` path-tag mechanism
  like cursor and opencode do (§10), instead of native blocks.

---

## 4. Facet: `sessions` — hard, and the SDK does **not** help here

Interface: `IProviderSessions` (`interfaces.ts:185-230`). Required: `normalizeMessage(raw, sessionId)`,
`fetchHistory(sessionId, options?)`. Optional and **skipped for the MVP**: `forkSession`,
`resolveEditAnchor`, `rewindSession` — the interface docs state that their *absence* is what disables the
corresponding UI feature.

Closest reference: `opencode-sessions.provider.ts` (721 lines).

### Where the data lives [V]

All under `~/.gemini/antigravity-cli/` (the CLI's app data dir; the IDE uses the sibling
`~/.gemini/antigravity/`).

| Artifact | Path | Use |
| --- | --- | --- |
| **Transcript** | `brain/<conversation-id>/.system_generated/logs/transcript.jsonl` | ✅ **Primary source.** Plain JSONL, one object per `step_index`, exactly `step_count` lines. |
| Untruncated transcript | `…/logs/transcript_full.jsonl` | Same records with nothing elided. `transcript.jsonl` truncates long `content`/`thinking` and names the elided keys in `truncated_fields`. |
| Chunk mirrors | `…/logs/chunks/transcript{,_full}/NNNNNNNN.jsonl` | Roll at exactly 102,400 bytes; the top-level file is byte-exactly `concat(chunks)`. Evidence of append-mode writing — you don't need to read these. |
| **Index** | `conversation_summaries.db` (SQLite, WAL) | ✅ **List view.** All plain columns, no blobs needed. |
| Large tool output | `…/.system_generated/steps/<idx>/output.txt` | Overflow for big tool results. |
| Per-conversation DB | `conversations/<id>.db` | ❌ **Do not touch.** Opaque protobuf blobs with integer `step_type` discriminators. Building on it means reverse-engineering a closed, fast-moving format. |

### Transcript record shape [V]

```jsonc
{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE",
 "created_at":"2026-09-20T23:46:50Z","content":"<USER_REQUEST>…</USER_REQUEST><ADDITIONAL_METADATA>…"}
{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"…",
 "thinking":"…","tool_calls":[{"name":"run_command","args":{"CommandLine":"…","Cwd":"…","toolSummary":"…"}}]}
{"step_index":2,"source":"MODEL","type":"GENERIC","status":"DONE","created_at":"…","content":"<tool result text>"}
{"step_index":3,"source":"SYSTEM","type":"SYSTEM_MESSAGE","status":"DONE","created_at":"…","content":"…"}
```

Observed enumerations [V] — `source` ∈ {`USER_EXPLICIT`, `MODEL`, `SYSTEM`}; `type` ∈ {`USER_INPUT`,
`PLANNER_RESPONSE`, `GENERIC`, `SYSTEM_MESSAGE`}; `status` ∈ {`DONE`, `RUNNING`, `ERROR`}. Optional keys:
`thinking`, `tool_calls[]`, `truncated_fields[]`, **`error`**. `created_at` is UTC RFC3339.

> **Corrected during the sessions work (Q1).** A sweep of all 41 `transcript.jsonl` files on the research
> machine — 513 records — found exactly the four documented `type` values and three `source` values, but two
> things this table originally omitted: `status` also takes **`ERROR`** (13 records) and **`RUNNING`** (9), and
> an undocumented **`error`** string field accompanies `status: "ERROR"`. `error` is where a
> denied-permission message actually lives; `content` only paraphrases it, so read `error` first. `RUNNING`
> on the last record is the transcript's own answer to "is this conversation live" — but the cheaper answer
> is `conversation_summaries.not_fully_idle` (§4), which is what the synchronizer uses.

> ⚠️ **This vocabulary is NOT in any published `.proto`** — verified by grep across all 25 SDK proto files.
> It is internal Cascade (`exa.cortex_pb`) naming. The SDK's `localharness.proto` helps the **runtime**
> facet, not this one. **Treat the four `type` values as an observed floor, not a closed set** [?], and pass
> unknown values through as generic text.

### Normalization notes

- **Unwrap the user envelope.** `USER_INPUT.content` is wrapped in `<USER_REQUEST>…</USER_REQUEST>` followed
  by `<ADDITIONAL_METADATA>…`. Strip both before rendering.
- **Tool calls and results are separate records.** A `PLANNER_RESPONSE` carries `tool_calls[]`; the *result*
  arrives as the following `MODEL`/`GENERIC` record's `content`. Pair them on adjacency.
- **`truncated_fields`** tells you which keys were elided — fall back to `transcript_full.jsonl` when you
  need the full text.
- **`fetchHistory` pagination:** `limit: null` = unbounded, `limit: 0` = empty page; always return
  `total`/`hasMore`/`offset`/`limit`. The providers README calls out "treating `limit === 0` as unbounded"
  as a *common mistake* (`README.md:373`) — someone has already got this wrong once.

### `conversation_summaries.db` columns [V]

`conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status, source,
project_id, agent_name, parent_conversation_id, nesting_depth, battle_id, winning_conversation_id,
not_fully_idle, killed, last_user_input_time, last_user_input_step_index, app_data_dir, raw_summary (BLOB),
group_id`

- Filter `app_data_dir = 'antigravity-cli'` to exclude IDE conversations.
- `preview` is the first user prompt. `title` is **often empty** for short CLI runs — 1.2.5+ deliberately
  skips the title-generating model call in headless runs. Fall back to `preview`.
- The project key is `project_id` — set by `--project` (ground rule #1); a run with no `--project` lands in
  a synthetic `default-cli-project`. `workspace_uris` only lists the added workspace roots and is populated
  only if `--add-dir` was passed.
- Weaker secondary source: `cache/last_conversations.json` maps workspace path → most recent conversation id.
- `not_fully_idle` (with `killed`) is `agy`'s own "this conversation is still working" flag, and it is the
  cheapest live-run signal on the machine: it rides a row the synchronizer already reads, where
  `presence/<id>.lock` costs a stat per conversation and the transcript's trailing `status` costs a file
  read. It is what `sessions.external_running_at` is written from — the only way a conversation started in a
  terminal or in the IDE shows as running in CloudCLI, since the chat run registry only knows our own runs.

---

## 5. Facet: `sessionSynchronizer` — moderate

Interface: `IProviderSessionSynchronizer` (`interfaces.ts:242-252`) — `synchronize(since?)`,
`synchronizeFile(filePath)`. Reference: `opencode-session-synchronizer.provider.ts` (179 lines), which
solves the identical "the CLI's storage isn't ours to touch" problem.

- **Scan root:** `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl` for content,
  `conversation_summaries.db` (filtered) for metadata/title/preview/mtime.
- **Tailing works** — records append one line per step; a two-turn conversation was watched growing from 2
  to 5 lines with earlier lines unchanged. [V]
- **Compaction fallback is mandatory** (ground rule #6): keep a full-re-read path keyed on `step_index`.
- **Live-session detection** is cheap: `presence/<id>.lock` (zero-byte liveness lock) plus the
  `not_fully_idle` / `status` columns (`status` values look like `CASCADE_RUN_STATUS_IDLE`). [V]
  **Shipped as `not_fully_idle` (AND NOT `killed`)**, written into `sessions.external_running_at` on every
  upsert. It is the only one of the three that costs nothing — it rides a row already read — and it is the
  one that does not need Q4's answer. The instant stored is the row's own `last_modified_time`, not the
  scan time, so an `agy` killed mid-turn (flag set, nothing left to clear it) ages out of the running list
  instead of showing busy forever.
- **Store `jsonl_path: null` for the shared DB**, exactly as opencode does, so deleting an app-tracked
  session can never delete the shared index.
- **Watcher registration:** the watch root is `~/.gemini/antigravity-cli/brain`, **not** the whole app data
  directory, and it is the one root `sessions-watcher.service.ts` registers only when it already exists — a
  machine without `agy` pays nothing, no directory created and no polling watcher attached. Under it, only
  `transcript.jsonl` is a trigger: `transcript_full.jsonl` is rewritten in lockstep with it, and the
  `logs/chunks/**` mirrors are `.jsonl` too and would otherwise fire an event per chunk per step. Watching
  `conversation_summaries.db` as well would buy nothing, because synchronizing a transcript re-reads that
  conversation's index row anyway. Note that **chokidar 4 matches a string `ignored` entry by equality, not
  as a glob** — the chunk ignore has to be a RegExp to do anything at all.

---

## 6. Facet: `models` — trivial to write, annoying to source

Interface: `IProviderModels` (`interfaces.ts:98-114`) — `getSupportedModels()`,
`getCurrentActiveModel(sessionId?)` (read-only, may fall back to a default).

- `agy models` prints **TSV** `id<TAB>display name`. Observed 2026-09-21 [V]:
  `gemini-3.8-flash-{high,medium,low}`, `gemini-3.7-flash-{high,medium,low}`,
  `gemini-3.6-flash-{high,medium,low}`, `gemini-3.1-pro-{high,low}`, `claude-sonnet-4-6`,
  `claude-opus-4-6-thinking`, `gpt-oss-120b-medium` — 15 entries.
- **Reasoning effort is baked into the model id** (`-high`/`-medium`/`-low`) *and* separately settable via
  `--effort`. Settled: the model id is the only path — effort is expressed by choosing a model, so
  `supportsEffort` is `false` and the flag is never passed (§10). Don't expose both paths.
- The list is **server-fetched and auth-gated** — unauthenticated returns empty with "Please sign in to view
  available models." **Ship a hardcoded fallback catalog** for the logged-out state. [V]
- `--output-format` is **rejected** by `agy models` on 1.2.7 despite the changelog claiming otherwise, so
  parsing means tab-splitting stdout. Brittle — prefer the hardcoded catalog as the primary and treat the
  TSV as a best-effort refresh. [V]
- **No context-window figure is exposed anywhere** — not in `agy models`, not in any config file, not as a
  readable string in the binary. Hardcode it. [V] This repo already has a per-model context-window
  declaration mechanism (commit `bbe0283b`); follow it.

---

## 7. Facet: `auth` — trivial, but inference-based

Interface: `IProviderAuth` (`interfaces.ts:124-129`) — `getStatus()` only. The providers README explicitly
sanctions a stable "not installed" stub (`README.md:124`).

- Sign-in is an **interactive OAuth browser flow** against a Google account. There is **no `agy login` /
  `agy logout` subcommand** — only in-TUI `/login` and `/logout`. [V] The provider-login modal should tell
  the user to run `agy` in a terminal and sign in there.
- **Credentials live in the OS keyring** (`wincred` on Windows), with a documented file-storage fallback
  when the keyring is unavailable (Linux without a D-Bus session bus, keyring timeouts). The fallback path
  could not be recovered [?]. **You cannot inspect a credentials file** — do not try.
- ⚠️ `~/.gemini/oauth_creds.json` belongs to the **Gemini CLI, not `agy`**. Do not read it. `agy` shares the
  `~/.gemini` parent directory but keeps its own state under `~/.gemini/antigravity-cli/` and
  `~/.gemini/config/`. [V]
- **Detecting login state non-interactively** (pick one, cheapest first): `agy models` returns an empty list
  when unauthenticated; `~/.gemini/antigravity-cli/log/cli-*.log` contains `You are not logged into
  Antigravity.`; `remote-control start` errors with `not signed in: …`. [V]
- A same-OS-user server process **does** inherit an existing login silently. [V] First login cannot be done
  headlessly — OAuth code paste needs a controlling terminal.
- Alternative auth paths exist in the binary: `GEMINI_API_KEY`, `GOOGLE_GEMINI_BASE_URL`, `AGY_ADC_AUTH`.
  Out of scope for the MVP.

---

## 8. Facet: `mcp` — trivial, thanks to the shared base

Extend `McpProvider` (`server/modules/providers/shared/mcp/mcp.provider.ts`, 151 lines) and implement
exactly four methods: `readScopedServers`, `writeScopedServers`, `buildServerConfig`,
`normalizeServerConfig` (`mcp.provider.ts:114-129`). Scope/transport validation is shared.

Scopes [D], global one confirmed on disk [V]:

| Scope | Path |
| --- | --- |
| Global (CLI **and** IDE) | `~/.gemini/config/mcp_config.json` |
| Workspace | `<workspace>/.agents/mcp_config.json` |
| Plugin-bundled | `~/.gemini/antigravity-cli/plugins/<name>/mcp_config.json` |

```json
{ "mcpServers": { "server-name": {
  "command": "executable-path", "args": ["..."],
  "serverUrl": "https://api.example.com/mcp/",
  "env": {"VAR":"value"}, "cwd": "/working/dir",
  "headers": {"Authorization":"Bearer TOKEN"},
  "authProviderType": "google_credentials",
  "oauth": {"clientId":"id","clientSecret":"secret"},
  "disabled": false, "disabledTools": ["tool-name"]
}}}
```

**Two gotchas versus this repo's existing providers:**

1. Remote servers use **`serverUrl`** — one field covers both `http` and `sse`. The docs state legacy `url` /
   `httpUrl` are *not* supported.
2. The disable switch is an inline **`"disabled": true`** field, not a separate list.

There is also a first-class CLI (`agy mcp add|remove|list|enable|disable`) if you prefer shelling out —
but writing the JSON directly matches what the other providers here do. Discovered tool schemas are cached
under `~/.gemini/antigravity-cli/mcp/<server>/<tool>.json`.

---

## 9. Facet: `skills` — trivial

Extend `SkillsProvider` (`shared/skills/skills.provider.ts`, 287 lines) and implement exactly one method,
`getSkillSources(workspacePath)` (`:282`), returning root directories. Frontmatter parsing is shared.
Reference: `cursor-skills.provider.ts` (39 lines).

Format is Claude-Code-shaped: `SKILL.md` with YAML frontmatter (`description` required, `name` optional,
defaulting to the folder name), auto-exposed as `/<skill-name>`. In print mode only the **read-only** slash
commands expand (`/help`, `/config`, `/permissions`, `/hooks`, `/changelog`) — `/fork` and `/rewind` reach
the model as literal text (Corrections table above); whether a skill's `/<name>` also expands headless is [?].
Opt out with `--disable-slash-commands`. [D][V]

Discovery roots:

| Scope | Path | Observed |
| --- | --- | --- |
| CLI global | `~/.gemini/antigravity-cli/skills/<skill>/` | absent on the test machine |
| IDE global | `~/.gemini/config/skills/<skill>/` | **present and populated** |
| Workspace | `<workspace>/.agents/skills/<skill>/` | — |
| Built-in | `~/.gemini/antigravity-cli/builtin/skills/<skill>/SKILL.md` | present (5 built-ins) |
| Plugin-bundled | `~/.gemini/antigravity-cli/plugins/<name>/` | none installed |

> [?] **Which global root the CLI actually scans is unconfirmed.** The docs name the CLI root; only the IDE
> root was populated on the test machine, and a skill was never observed being invoked from it. Return both
> as candidates until §13-Q2 is resolved.

Adjacent, out of MVP scope but worth knowing: rules/memory at `<repo>/.agents/rules/*.md`,
`~/.gemini/antigravity-cli/rules/`, `~/.gemini/GEMINI.md` (12,000-char cap per rule file); custom agents at
`<repo>/.agents/agents/<name>.md` selected with `--agent`; hooks at `.agents/hooks.json`.

---

## 10. Capability matrix

`server/modules/providers/services/provider-capabilities.service.ts` is a static
`Record<LLMProvider, ProviderCapabilities>` that the frontend reads **instead of branching on provider id**.
Degrading gracefully is a designed-in mechanism, not a hope — cursor ships today with
`supportsPermissionRequests / supportsTokenUsage / supportsEffort / supportsCompact / supportsFork /
supportsClear / supportsMessageEditing / supportsSessionForking` all `false` (`:90-107`).

The `antigravity` entry, settled on 2026-09-21. Each value is a finding or a recorded decision, not a suggestion:

| Capability | Value | Because |
| --- | --- | --- |
| `permissionModes` | `['default', 'bypassPermissions']` | ADR 0015 — the other two are ignored in print mode |
| `defaultPermissionMode` | `'default'` | pre-granted actions only, plus the one-click-allow loop |
| `supportsImages` | `true` | paths ride in an `<images_input>` tag as plain text, exactly as cursor and opencode do (`server/shared/image-attachments.ts`), so the stream-json "text blocks only" limit never applies. [?] verify `agy` actually reads the image |
| `supportsFiles` | `true` | same, via `<files_input>` |
| `supportsAbort` | `true` | kill the process tree; borrow `killOpenCodeProcessTree` |
| `supportsPermissionRequests` | `false` | [V] headless cannot prompt at all — ADR 0015 |
| `supportsTokenUsage` | `true` | `usage` is on every `step_update` and on `result` (§3) |
| `supportsEffort` | `false` | effort is baked into the model id and not uniform across models; the flag is never passed (§6) |
| `supportsCompact` | `false` | [V] the slash-command registry has **no** `/compact`, only `/context`. A fact, not a conservative default |
| `supportsFork` / `supportsSessionForking` | `false` | ADR 0014 |
| `supportsMessageEditing` | `false` | ADR 0014 |
| `rewindRestoresFiles` | `false` | nothing to restore without Edit |
| `supportsClear` | `true` | Clear is a new session plus an archive (ADR 0005); for `agy` starting a new session is just omitting `--conversation` — no provider API to call |

The `false`s that reflect a decision rather than a missing upstream feature are already recorded: ADR 0014
(Fork and Edit) and ADR 0015 (permissions), alongside the established `0004-no-codex-compact-via-sdk.md`,
`0008-no-codex-rewind-or-fork.md` and `0009-a-committed-opencode-revert-is-reported-not-recovered.md`.

---

## 11. Wiring checklist — outside the provider directory

**Every one of these files is upstream-owned** (verified at `upstream/main` @ `5e73a49b`:
`git cat-file -e upstream/main:<path>` succeeds for all 21). Marginal cost is ~100 lines of mostly one-line
list/map entries, but each one is future merge-conflict surface. **8 of the 15 core files are byte-identical
to `upstream/main` @ `5e73a49b`** — adding this provider is what dirties them.

Do them in this order; after step 1 the TypeScript compiler will point at almost everything else.

| # | File | Change | Merge risk |
| --- | --- | --- | --- |
| 1 | `server/shared/types.ts:69`, `src/shared/types.ts:8` | Add `'antigravity'` to the `LLMProvider` union. **Append at the end** — keeps the conflict hunk minimal. | 🟠 The exact line upstream edits when *it* adds a provider. Guaranteed conflict, trivially resolved as "keep both". |
| 2 | `server/modules/providers/provider.registry.ts:1-14` | One import + one map entry. | 🟢 |
| 3 | `server/modules/database/schema.ts:189` | Extend `CHECK (provider IN (…))` **and ship a real migration** in `migrations.ts` — a SQLite `CHECK` needs a table rebuild, not an in-place edit. | 🔴 **The only touchpoint where a bad merge causes real damage** (runtime DB errors; a duplicated/misordered migration can corrupt an existing DB). Both sides rewrite the same line and both append to the same migration sequence. |
| 4 | `src/shared/constants.ts` | One key each in 5 maps: `MCP_PROVIDER_NAMES` (`:118`), `MCP_SUPPORTED_SCOPES` (`:126`), `MCP_SUPPORTED_TRANSPORTS` (`:134`), `MCP_SUPPORTS_WORKING_DIRECTORY` (`:145`), `PROVIDER_PERMISSION_PREFERENCE_KEYS` (`:215`). | 🟢 |
| 5 | `server/modules/agent/agent.routes.ts` | ~11 sites: type field, runner wiring, allow-list checks (`:899-900`), spawn branch (`:1018-1025`). | 🟠 Scattered edits in an actively-churning file. |
| 6 | `server/index.ts:118,127` | Runner resolve + dependency wiring. | 🟢 |
| 7 | `server/modules/providers/provider.routes.ts:291`, `server/modules/commands/commands.routes.ts:31,37` | One entry each. | 🟢 |
| 8 | `src/modules/chat/hooks/useChatProviderState.ts` | 5 sites: effort levels (`:24`), default model (`:35`), `PROVIDERS` array (`:38`), permission modes (`:53`). | 🟠 |
| 9 | `src/modules/chat/transcript/ProviderSelectionEmptyState.tsx` | id/name list (`:34`), display-name switch (`:81`), i18n-keyed ready prompt (`:325-327`). | 🟢 |
| 10 | `src/shared/ui/LLMProviderLogo.tsx:25-26` | One dispatch branch → the new logo component. **The logo asset itself needs real design work** — not mechanical. | 🟢 |
| 11 | `src/modules/provider-auth/ProviderLoginModal.tsx:58-59,69` | CLI login command string + modal title. See §7 — there is no `agy login`; tell the user to run `agy` and use `/login`. | 🟢 |
| 12 | `src/modules/mcp/McpServers.tsx:23` | One Tailwind class-map entry. | 🟢 |
| 13 | `src/modules/settings/tabs/agents-settings/**` (4 files), `src/modules/chat/modals/ModelLibraryPanel.tsx`, `src/modules/onboarding/AgentConnectionsStep.tsx`, `src/modules/skills/ProviderSkills.tsx` | Small per-provider branch/entry each. Onboarding copy and UI category grouping need a judgment call. | 🟢 |
| 14 | `src/modules/i18n/locales/{en,es,fr,ko,zh-CN}/{chat,settings}.json` | ~5–10 short strings each. Note 6 of 11 locales (`de it ja ru tr zh-TW`) never received opencode's strings either — matching that precedent is acceptable. | 🟢 |
| 15 | `server/modules/providers/services/sessions-watcher.service.ts` | One watch-root entry (`~/.gemini/antigravity-cli/brain`, registered only when it exists), one `isWatcherTargetFile` branch, one RegExp ignore for the chunk mirrors. See §5. | 🟠 The root list and the ignore list are both places upstream edits when *it* adds a provider; keep both sides' entries. |
| 16 | `server/modules/database/schema.ts` + `migrations.ts`, `repositories/sessions.db.ts`, `server/modules/providers/services/sessions.service.ts` | The `sessions.external_running_at` marker: column + `addSessionExternalRunningAtColumn`, the `setSessionExternalRunningAt` / `getExternallyRunningSessions` pair, and the union in `listRunningSessions`. | 🟠 Another append to the same migration sequence as row 3 — same rule: keep both, ours last. |
| 17 | 11 shared cross-provider test files (§12) | Add a case to an existing loop/table. | 🟢 |
| 18 | **`docs/fork-customizations.md` + `.zh-CN.md`** | **Due with the first code commit.** A whole new provider is a fork-specific customization by definition; per `.claude/CLAUDE.md` the entry ships with the work that diverges from upstream, not as a follow-up. The docs-only planning commits that precede it owe no entry. | — |

---

## 12. Tests

- **Provider-owned** (`server/modules/providers/tests/`): sessions parsing and models are where the real
  value is — opencode's are 321 and 73 lines. A runtime test can be large (opencode's is 873).
  Fixture the NDJSON event stream and a real `transcript.jsonl` rather than mocking at a high level.
- **Shared cross-provider** (11 files): `providers/tests/{mcp,skills,provider-capabilities.service,
  provider-models.service,provider-runtime.service,provider-token-usage.service}.test.ts`,
  `websocket/tests/chat-run-registry.test.ts`, `agent/tests/agent.routes.test.ts`,
  `src/modules/chat/tests/{chatProviderModels,composerToolsSettingsResolution}.test.ts`,
  `src/modules/git-panel/tests/selectedProviderSync.test.tsx`.
- Run: `npm test` (backend) **and** `npm run test:client` (frontend) — they are separate suites.
  Single file: `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/<f>.test.ts`.

---

## 13. Open questions

Q1, Q3 and Q7 were settled while building. The three that remain all need a live `agy` and a real run, which
is exactly why they are still open: nothing in the implementation depends on an unverified answer to any of
them — each is either routed around (Q2, Q4) or outside what this fork ships (Q5, Q6).

| # | Question | Status / how to settle it |
| --- | --- | --- |
| ~~Q1~~ | ~~Is the `transcript.jsonl` `type` vocabulary larger than the four observed values?~~ | **Closed — no, but the record shape is.** A sweep of all 41 transcripts on the research machine (513 records) found exactly the four `type` values and three `source` values. It also found two things the research missed: `status` ∈ {`DONE`, `RUNNING`, `ERROR`} and an undocumented `error` field (§4). One machine's corpus, so the four types stay a floor — which is why the normalizer is field-driven rather than `type`-driven, and an unseen type renders as text instead of vanishing. |
| Q2 | Which global skills root does the CLI actually scan — `~/.gemini/antigravity-cli/skills/` or `~/.gemini/config/skills/`? | **Open, routed around.** The skills facet returns **both** candidates rather than guessing, so a wrong answer costs a spurious root, not a missing skill. Settle it by putting a trivially identifiable skill in each root, invoking `/name` in print mode, and seeing which fires; then drop the loser from `antigravity-skills.provider.ts` and from the skills table in `server/modules/providers/README.md`. |
| ~~Q3~~ | ~~Better project key than `--add-dir`?~~ | **Closed.** `--project <id>` works and is honoured — `cli.log` logs `Conversation using project ID: <id>`. It is also the only scope a permission grant applies in. ADR 0015. |
| Q4 | Can a second `agy` process safely observe a conversation another process is actively running? | **Open, and deliberately no longer load-bearing.** The `presence/<id>.lock` files suggest exclusivity; still untested. Nothing opens a lock or holds a handle — every read is `readFileSync` / `db.close()` in a `finally` — and the live-running marker reads `conversation_summaries.not_fully_idle` rather than the lock for the same reason. The worst case is a stale read corrected on the next scan. Settle it by starting a long turn in one terminal and running `agy --conversation <id>` from another. |
| Q5 | Is `AGENTS.md` honoured as a rules file, and at what precedence vs `GEMINI.md`? | **Open, outside what this fork ships** — no facet reads either file. The string exists in the binary; the docs name only `GEMINI.md`. Test with a contradictory instruction in each and see which the model follows. |
| Q6 | Where does the file-based token-storage fallback write when the keyring is unavailable? | **Open, and only matters for Linux/container deployments.** The auth facet infers sign-in from `agy models` rather than reading any credential store (ADR 0013), so the answer changes nothing here today. Run in a container with no D-Bus and watch the filesystem. |
| ~~Q7~~ | ~~Any CLI-triggerable compaction?~~ | **Closed — no.** The 35-command slash registry extracted from the binary has no `/compact`. `supportsCompact` stays `false`. |

---

## 14. Do not

- ❌ Parse `conversations/<id>.db` — opaque protobuf, closed and fast-moving format (§4).
- ❌ Hand-roll `antigravity.localharness.*` protobuf bindings to talk to the harness over its local
  WebSocket. Technically possible, but it is reverse engineering *and* it moves toward the pattern ToS §6
  objects to. Use the CLI's documented NDJSON.
- ❌ Read `~/.gemini/oauth_creds.json` — that is the Gemini CLI's, not `agy`'s (§7).
- ❌ Write to or delete `conversation_summaries.db` (ground rule #3).
- ❌ Run `agy` without `--project` (ground rule #1) — `--add-dir` alone attributes nothing and grants nothing.
- ❌ Let the spawned `agy` self-update mid-run (ground rule #2).
- ❌ Add `antigravity` to a `Record<LLMProvider, …>` map by *reordering* existing entries — append only, to
  keep merge hunks small (§11).
- ❌ Assume `npm test` covered the frontend. It didn't (§12).
- ❌ **Trust `result.status` or the exit code to tell you a turn worked.** A turn whose every tool call was denied still reports `status: "SUCCESS"` and exits 0, with an empty `response`. Read `denied_actions`.
- ❌ **Bill a call from `result.usage`.** On a resumed conversation `usage`, `duration_seconds` and `num_turns` are all conversation-cumulative. The per-step `usage` is the per-call number.
- ❌ Write permission grants into `settings.json` — they are loaded and then cleared the moment a project with no grants is named (§15).


---

## 15. Permissions — mechanics

The design and the rejected alternatives are in **ADR 0015**; this is what it looks like on disk.

Headless `agy` cannot prompt. A tool needing permission is auto-denied, and the run reports success anyway
(see §14). Pre-granting is the only lever, and it is project-scoped:

```
~/.gemini/config/projects/<project-id>.json
{
  "id": "<project-id>",
  "name": "<display name>",
  "projectResources": { "resources": [ { "folderUri": "file:///d%3A/code/foo" } ] },
  "permissionGrants": { "permissionGrants": { "allow": [ "command(npm run build)", "read_url(example.com)" ] } },
  "settings": { "fileAccessPolicy": "...", "sandboxMode": false, "autoExecutionPolicy": "..." },
  "isWorkspaceOnly": false
}
```

- **Resolve, do not create.** Match a CloudCLI Project to the Antigravity project whose `folderUri`
  covers its path; only create one when none does. Reusing the user's own record is what makes a grant
  given in the Antigravity IDE apply here too. `folderUri` is a percent-encoded `file://` URI with a
  lowercase drive letter (`file:///d%3A/...`).
- **Action kinds:** `read_file` `write_file` `read_url` `execute_url` `command` `unsandboxed` `mcp`.
  Precedence is `deny > ask > allow`; `write_file` on a path implies `read_file`, and denying `read_file`
  denies `write_file`.
- **Matching is exact.** `command(echo)` does **not** cover `echo hello` — verified. A rule names the
  whole command, which is why the one-click-from-a-denial loop (mirroring `ClaudePermissionSuggestion`)
  is the only usable way to build the list.
- **Global grants are not a fallback.** `~/.gemini/config/config.json` holds
  `userSettings.globalPermissionGrants`; `cli.log` shows them loaded and then cleared by
  `ApplyProjectPermissionGrants` when the named project carries none.
- **Escape hatch:** `--dangerously-skip-permissions` is the `bypassPermissions` mode. There is no
  per-invocation allow flag.
- **Concurrency:** the record is shared with the Antigravity IDE and the user's terminal. Read, modify,
  write the smallest possible change; never hold a transient grant across a run.

**What a refused turn actually looks like [V] `agy` 1.2.8** — from the first live check, headless, empty
allow list, asked to run `echo FIRSTCHECK_SENTINEL`:

- **stderr names no rule.** The whole notice is boilerplate — `… auto-denied. Add an allow-rule under
  permissions.allow in settings.json (e.g. command(<target>)).` The `command(<target>)` in it is the
  *form* of a rule, not the refused one, so scraping it would offer a grant that matches nothing. Filter
  any candidate whose argument is a bare `<placeholder>`.
- **The command text lives on the tool step**, and is the only place it appears:
  `step_update.tool_info.parameters.CommandLine` for `tool_name: "run_command"` (a per-tool `parameters`
  object, not a flat `command` field). Where the other action kinds keep their arguments is still [?].
- **`denied_actions` carries the kind only:** `[{"action":"command","display_name":"RunCommand"}]`.
- **`result.status` is `SUCCESS`** on that same refused turn, with `response: ""` — §14's "never trust the
  status" rule confirmed live, not just inferred.