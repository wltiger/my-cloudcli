# Antigravity (`agy` CLI) as a CloudCLI provider — feasibility and change footprint

Research date: **2026-09-21**. Subject: `agy` **1.2.7** (Google Antigravity CLI), Windows 11 x64, installed
at `%LOCALAPPDATA%/agy/bin/agy`. Measured against the 7-facet provider contract in
`server/modules/providers/README.md`.

**If the decision is "build it", the implementation guide distilled from this research is
`docs/agents/antigravity-provider-implementation.md`** — read that to build, read this to check why a
claim holds.

> ⚠️ **Partly superseded — 2026-09-21.** The plan was settled in a grilling session that ran further live
> tests against `agy` 1.2.7, and several claims below did not survive. The decisions are recorded in
> `docs/adr/0013-…`, `docs/adr/0014-…` and `docs/adr/0015-…`; the full list of what changed is the
> **"Corrections to the research"** table near the top of
> `docs/agents/antigravity-provider-implementation.md`. The headlines: `/rewind` and `/fork` exist but are
> TUI-only and unusable headless; there is no `/compact` at all; `--mode accept-edits|plan` is ignored in
> print mode; permissions live in `~/.gemini/config/projects/<id>.json`, not `settings.json`, and
> `--project` — not `--add-dir` — is the project key; and a fully denied turn still reports
> `status: "SUCCESS"` with exit code 0. Treat anything here that those records contradict as history.

This is a research note, not a decision. It answers two questions separately — *can it be done* (Part A,
against the `agy` binary, its data files and Google's first-party docs) and *what does this repo make you
pay* (Part B, against the four existing providers).

---

## Verdict

**Technically: yes, and it is one of the easier providers to add.** `agy` has a first-party documented
headless mode with a typed NDJSON event stream (`--output-format stream-json`), resume-by-conversation-id,
a stdin driver loop for multi-turn, and — the decisive finding — it writes a **plain append-only
`transcript.jsonl`** per conversation alongside a shared plaintext SQLite index. That is structurally the
same shape as the existing OpenCode provider, not the codex app-server shape. No reverse engineering of the
opaque per-conversation protobuf `.db` files is needed.

**Legally: lower risk than it first looked, but not zero.** See "ToS §6 — reassessed" below. Short
version: the clause's own example (OpenClaw) turned out to describe *credential borrowing* — pointing a
different agent product at Antigravity OAuth tokens to call Google's backend models — and Google's own
official SDK works by spawning a Google-shipped binary as a subprocess, which is architecturally identical
to what CloudCLI would do with `agy`. The residual risk is about *deployment shape*, not architecture.

### Facet summary

| Facet | Verdict | Note |
| --- | --- | --- |
| `runtime` | ✅ Supported | `agy -p` + `--output-format stream-json`; typed `init`/`step_update`/`result` NDJSON with `text_delta` and `usage`. **No Node SDK** — subprocess only (the official SDK is Python, alpha). |
| `models` | ⚠️ Partial | `agy models` is TSV-only and auth-gated on 1.2.7; **no context-window metadata** → would be hardcoded. |
| `auth` | ⚠️ Partial | OAuth, credentials in the **OS keyring** (not a readable file). No scriptable login-status command; state must be inferred. |
| `mcp` | ✅ Supported | `agy mcp add/list/enable/...`; user scope `~/.gemini/config/mcp_config.json`, project scope `<ws>/.agents/mcp_config.json`; stdio + http/sse. |
| `skills` | ✅ Supported | Maps onto `SkillsProvider` with `/` prefix; only open question is which global skills root is actually scanned. |
| `sessions` | ✅ Supported | `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl` (plain JSONL) + `conversation_summaries.db` (plaintext columns, shared with the IDE — read-only, filter `app_data_dir='antigravity-cli'`). |
| `sessionSynchronizer` | ✅ Supported | Append-only tailing verified; needs a full-re-read fallback because context compaction rewrites the file, and must upsert on `(conversation_id, step_index)`, not line number. |

### The gotchas that change the implementation

1. **`--add-dir <projectPath>` is mandatory.** Verified directly: without it, `workspace_uris` is empty and
   the session cannot be attributed to a project (30 of 33 existing CLI conversations were unattributable).
2. **Never delete `conversation_summaries.db`** — it is shared with the Antigravity IDE. Same rule the
   OpenCode synchronizer already follows.
3. **Compaction rewrites `transcript.jsonl`** — a naive byte-offset tail will desync and can read a torn line.
4. **No headless image/file attachments** — `stream-json` input accepts `text` blocks only.
5. **Quota is per-account and weekly**, spent per turn. A multi-user hosted CloudCLI would burn one account's
   allowance. There is no API-key-billed path.
6. **Surface churn** — 50 releases from 1.0.0 to 1.2.6, with headless semantics (timeouts, exit codes, slash
   commands) changing repeatedly.

### ToS §6 — reassessed

Antigravity's ToS §6 forbids *"using third party software, tools, or services to access the Service
(e.g. using OpenClaw with Antigravity OAuth)"* [13]. Follow-up research into what that clause actually
targets, and into how Google's own SDK is built, materially lowers the risk.

**What OpenClaw actually did.** The February 2026 enforcement wave hit users who pointed OpenClaw's OAuth
plugin at Antigravity credentials so that a *different* agent product could call Google's backend models.
Google's stated reason, per its emails to affected users, was using Antigravity server credentials to power
a non-Antigravity product; reporting attributes the crackdown to backend load spikes from arbitraging
subsidised Gemini tokens [18][19][20]. That is credential borrowing — not "a UI that runs the official CLI."

**What Google's own SDK does.** `google-antigravity`, the official Python SDK (Apache-2.0,
`github.com/Google-Antigravity/antigravity-sdk-python`), ships a compiled `localharness` binary inside its
platform wheels and drives it **as a child process** — `subprocess.Popen([self._binary_path], stdin=PIPE,
stdout=PIPE, stderr=PIPE)` at `google/antigravity/connections/local/local_connection.py:1404` — then talks
to it over a **local** WebSocket (`ws://{host}:{port}/`, `local_connection.py:1359`) authenticated with an
ephemeral local handshake key (`additional_headers={"x-goog-api-key": api_key}`, `:1363`) [21]. All model
traffic leaves through the Google-shipped binary; the SDK itself never holds the user's Antigravity
credentials.

**Where CloudCLI would sit.** Spawning `agy -p --output-format stream-json` and parsing stdout is the same
architecture: third-party code driving the official Google-shipped agent binary, which does its own auth and
its own backend calls. Google separately publishes a headless-mode guide containing a `subprocess.Popen`
wrapper example doing exactly this [7]. CloudCLI would never see, store or forward an OAuth token — they
stay in the OS keyring where `agy` put them (§3.3).

**Residual risk, stated plainly:**

- The clause as written is broad and its "e.g." is illustrative, not limiting. A literal reading still covers
  a third-party front-end, and no first-party text blesses front-ends.
- Enforcement was automated and unannounced — no warning, no refund, no clear appeal, including for paying
  Ultra subscribers [19][20]. The downside is losing the account's access to the service.
- **Deployment shape matters more than architecture.** A self-hosted, single-user CloudCLI driving `agy` at
  human speed is indistinguishable from normal CLI use, because it *is* normal CLI use. A **hosted,
  multi-user** CloudCLI funnelling many users through one Antigravity account would reproduce the load
  pattern Google acted on, and quota is per-account and weekly (§1) — treat that shape as out of bounds.

**Assessment: downgraded from "hard blocker" to "acceptable risk for the self-hosted single-user shape,"**
with the multi-user caveat above. This is a risk judgment, not legal advice, and remains the maintainer's call.

### SDK availability

| Candidate | What it is | Usable from CloudCLI? |
| --- | --- | --- |
| `google-antigravity` (PyPI) | **The official SDK. Python only**, Apache-2.0, `Development Status :: 3 - Alpha`. Rich surface: hooks, custom tools, subagents, compaction, cancellation, budget limits, MCP, structured output [21]. | ❌ Not from Node without a Python bridge. |
| `@google/antigravity` (npm) | Does not exist — registry returns `{"error":"Not found"}` [22]. | ❌ |
| `antigravity`, `agy` (npm) | Unrelated squatter placeholders at `0.0.0` [22]. | ❌ |
| `antigravity-sdk` (npm, v1.7.0) | **Community, not Google**: authored by an individual, AGPL-3.0, described as "Community SDK for building extensions for Antigravity IDE", sole dependency `sql.js` [22]. Targets the IDE's extension surface, not the agent runtime. | ❌ Wrong surface, and AGPL is incompatible with this project. |
| `localharness` local WebSocket + protobuf | The transport the official SDK uses. Technically reachable from Node, but would require hand-rolling the `antigravity.localharness.*` protobuf bindings against a closed, fast-moving schema. | ⚠️ Possible but not advisable — it is reverse engineering, and it moves *toward* the pattern §6 objects to. |

**Conclusion: there is no Node SDK, and CloudCLI does not need one.** Subprocess + NDJSON is the documented
first-party path, and it is how three of this repo's four existing providers (codex, cursor, opencode)
already work — only the Claude provider uses an SDK.

### Using the official Python SDK as a reference

**Licensing clears this.** The SDK is Apache-2.0; CloudCLI is `AGPL-3.0-or-later` (`package.json:141`).
Apache-2.0 is one-way compatible into AGPLv3 — code may be incorporated or ported, provided the Apache
copyright/NOTICE is preserved and modifications are marked. So this is not merely "read for inspiration";
literal porting is permitted.

**Caveat first: the transports differ.** The SDK speaks protobuf over a local WebSocket to a bundled
`localharness` binary; CloudCLI would read NDJSON from `agy`'s stdout. Wire-level code does not transfer —
**state machines and semantics do**.

| SDK artifact | What it gives you | Transfers? |
| --- | --- | --- |
| `proto/localharness.proto` (842 lines) [23] | Canonical enums: `StepUpdate.State` (`UNSPECIFIED/ACTIVE/DONE/WAITING_FOR_USER/ERROR`), `StepUpdate.Source` (`SYSTEM/USER/MODEL`), `StepUpdate.Target`, `TrajectoryStateUpdate.State` + `StopReason` (incl. `QUOTA_EXHAUSTED` and the max-model-call / max-token limits), `PolicyDecision`, `ToolExecutionMode`, `LifecycleHook`, usage/budget messages. | ✅ **High value.** The CLI's `stream-json` uses these names with the `STATE_`/`SOURCE_` prefix stripped, so this closes the "is the `step_type` vocabulary closed?" unknown for the **runtime** facet, and gives exhaustive stop-reason handling for free. |
| `connections/local/event_processor.py` | How raw `StepUpdate` deltas are buffered and folded into completed steps: dedup by `step_index`, re-emission across state transitions, partial-text accumulation. | ✅ This is precisely the runtime normalizer CloudCLI needs. Port the state machine. |
| `connections/local/local_connection.py` | Child-process lifecycle: spawn, readiness handshake, stderr pump, graceful shutdown escalating through `subprocess.TimeoutExpired` (`:625-629`). | ✅ Good reference for process teardown (compare opencode's runtime). |
| `connections/local/proto_converters.py`, `struct_converter.py` | Tool-argument / tool-result shape conversion. | 🟡 Useful as a shape reference; the CLI already emits JSON, so most of it is unnecessary. |
| `examples/getting_started/*.py` (34 files) | Runnable specs for `cancellation`, `compaction`, `persistence`, `human_in_the_loop`, `slash_commands`, `mcp_tools`, `agent_skills`, `subagents`, `streaming`, `budget_limits`, `policies`, `hooks`, `sandboxing`. | ✅ Each maps onto a facet or a capability decision — the cheapest way to learn intended semantics. |
| `proto/steps.proto`, `content.proto`, `tools.proto` | The Gemini-side content/step model (thought steps, tool call/result variants, code execution, file-edit line actions). | 🟡 Informative, but this is the model-facing layer, not what `agy` emits. |
| — | **`transcript.jsonl`'s vocabulary** (`USER_EXPLICIT`, `PLANNER_RESPONSE`, `GENERIC`, `SYSTEM_MESSAGE`) | ❌ **Not present in any published `.proto`** — verified by grep across all 25 files. That is internal Cascade (`exa.cortex_pb`) naming. The **`sessions` facet still needs empirical mapping** from real transcripts. |

**Net effect on the estimate:** the `runtime` facet gets materially easier (canonical enums + a portable
event-folding state machine instead of inferring both from observation). The `sessions` facet does not —
the SDK never touches `transcript.jsonl`.

**Operational finding while checking this:** the `agy` binary defines `AGY_CLI_DISABLE_AUTO_UPDATE` among
~18 `AGY_*` environment variables [24]. `agy` self-updates by default, so a provider must set this and pin a
known-good version — otherwise the CLI surface can change under a running deployment (§4 already flags 50
releases across 1.0.0→1.2.6). There is **no app-data-dir override on the CLI** (the SDK's `app_data_dir` has
no CLI equivalent [23]), so CloudCLI's sessions would share the user's `~/.gemini/antigravity-cli/` store —
consistent with this project's read-the-native-store design, not a problem.

**Merge-risk note:** every line derived from this reference work lands in the new `list/antigravity/`
directory — zero upstream conflict surface.

### Change footprint and upstream-merge risk

The question that matters for this fork is not effort in days but *how much of the change lands in files
`upstream/main` also owns*, because every such line is a future merge conflict. Measured against
`upstream/main` @ `5e73a49b` (not yet merged into `dev`).

**The good news: ~95% of the code is new, conflict-proof files.**

| | Where | Size | Merge risk |
| --- | --- | --- | --- |
| New provider implementation | `server/modules/providers/list/antigravity/**` (new dir) + one new logo component | ~2,000–3,000 lines, bracketed by cursor (1,638) and opencode (~2,980 excl. test) | **None.** Upstream has no such path; a merge can never conflict with it. |
| Wiring into upstream-owned files | ~20 files (core) | **~100 marginal lines**, almost all one-line list/map entries | Low-to-moderate, but recurring — see below |
| i18n strings | 10 locale JSON files | ~50 lines | Low (JSON key additions) |
| Shared cross-provider tests | 11 files | ~30 lines | Low (add a case to an existing table) |

**The bad news: every single wiring file is upstream-owned.** All 21 touchpoints were checked with
`git cat-file -e upstream/main:<path>` at `5e73a49b` — **21/21 exist upstream**. There is no way to register a provider
purely in fork-owned files: `providers: Record<LLMProvider, IProvider>` in
`server/modules/providers/provider.registry.ts:9` forces the `LLMProvider` union to be edited, and that
union is upstream's (`server/shared/types.ts:69`, `src/shared/types.ts:8`).

**What makes this worse than a typical fork customization:** upstream is itself the party that adds
providers (claude → cursor → codex → opencode all came from upstream). So the exact lines a 5th provider
must edit — the two unions, the registry map, the `Record<LLMProvider, X>` maps in `src/shared/constants.ts`,
the DB `CHECK` list — are the lines upstream will edit next time *it* adds a provider. Collision on those
hunks is likely, not hypothetical.

**Mitigating fact:** 8 of the 15 core wiring files are **byte-identical to `upstream/main` @ `5e73a49b`**
(`git diff --numstat upstream/main dev` reports no change for `provider.registry.ts`, `constants.ts`,
`LLMProviderLogo.tsx`, `agent.routes.ts`, `commands.routes.ts`, `McpServers.tsx`, `ProviderLoginModal.tsx`,
`AgentConnectionsStep.tsx`). Adding a provider is what would dirty them. The 7 that already diverge are
`server/index.ts` (+33), `migrations.ts` (+165), `schema.ts` (+20), `server/shared/types.ts` (+95),
`useChatProviderState.ts` (+55), `ProviderSelectionEmptyState.tsx` (+23/-7), `src/shared/types.ts` (+52).

#### Risk ranked

| Risk | Where | Why | Mitigation |
| --- | --- | --- | --- |
| 🔴 **DB `CHECK` + migration** | `server/modules/database/schema.ts:189` (`provider IN ('claude','cursor','codex','opencode')`) plus a new migration in `migrations.ts` (fork already +165 lines there) | Both sides rewrite the *same single line*, and both append to the same migration sequence. A mis-merged `CHECK` is a runtime DB error, and a duplicated/misordered migration can corrupt an existing DB — this is the only touchpoint where a bad merge does real damage rather than just failing to compile. | Record the exact resolution rule in `docs/fork-customizations.md` up front: the `CHECK` list is always the *union* of both sides, and the fork's migration always sorts after upstream's. |
| 🟠 **The two `LLMProvider` unions** | `server/shared/types.ts:69`, `src/shared/types.ts:8` | One-line union member on the line upstream edits to add its own provider. Guaranteed textual conflict, trivially resolved as "keep both". | Append the new member at the **end** of the union so the conflict hunk is as small as possible. |
| 🟠 **Scattered per-provider branches** | `server/modules/agent/agent.routes.ts` (~11 sites), `src/modules/chat/hooks/useChatProviderState.ts` (5 sites) | Many small edits across an actively-churning file; each is its own potential hunk. | Nothing structural — but the TS compiler catches every miss after a merge, so a bad resolution fails the build rather than shipping silently. |
| 🟢 **Enumerated maps** | `src/shared/constants.ts` (5 maps), `provider.registry.ts:9-14`, `commands.routes.ts:31,37`, `McpServers.tsx:23`, `LLMProviderLogo.tsx:25` | Pure "add one key to a literal". Conflicts are both-sides-add; resolution is mechanical. | Append, don't reorder. |
| 🟢 **i18n + shared tests** | 10 locale files, 11 test files | Additive only. | — |

#### Bottom line on merge difficulty

The change is **wide but shallow**: ~35–45 upstream-owned files touched, but almost every touch is a single
appended line into a list, and the TS compiler enforces completeness after every merge. The bulk of the
work (~95% of lines) sits in a brand-new directory upstream will never touch.

It is **not** the destructive kind of divergence — nothing in this plan restructures shared upstream code,
changes a shared function's signature, or moves files around. The one place a bad merge does real harm is
the DB `CHECK` constraint plus its migration; that deserves a written resolution rule before any code lands.

For reference, Part B §7 below also contains an engineer-day breakdown, which was produced before this
footprint analysis and is not the basis of the recommendation here.

### Suggested next step

Settle ToS §6 first. If it clears, the cheapest de-risking step is a throwaway spike: spawn `agy -p
--output-format stream-json --add-dir <repo>` from Node, map the NDJSON to CloudCLI's normalized message
shape, and tail one `transcript.jsonl` through a compaction — that exercises every hard part in ~1 day.

---

## Part A — the `agy` CLI, measured

Research date: 2026-09-21. Installed version under test: **`agy` 1.2.7**, Windows 11 x64.
Measured against the 7-facet provider contract in `D:/code/opensource/claudecodeui/server/modules/providers/README.md` [17].

Evidence labels used throughout:
- **[OBS]** — observed directly on this machine (ran the binary, read the files it wrote)
- **[BIN]** — string/table extracted from the shipped `agy.exe` binary itself
- **[DOC]** — first-party documentation on `antigravity.google`
- **[INF]** — inference; stated as such, never presented as fact

---

### 1. What Antigravity / agy is

**Product.** Antigravity is Google's agentic development product line. It ships as (a) *Antigravity 2.0*, a desktop IDE (a VS Code / Electron fork), and (b) **`agy`**, a terminal coding agent CLI [8]. Google is the vendor; the docs, ToS, OAuth endpoints and auto-updater are all on `antigravity.google` [8][12][13].

**Lineage (relevant to how it behaves).** The shipped binary is a **Go** executable whose embedded protobuf descriptors are almost entirely `exa.*` packages (`exa.cortex_pb`, `exa.codeium_common_pb`, `exa.jetski_cortex_pb`, `exa.cascade_plugins_pb`) plus `antigravity.localharness.*`, and whose Go symbol paths are `google3/third_party/jetski/...` [BIN, 2]. `exa`/Cascade is the Codeium–Windsurf agent engine; internally the CLI still calls itself **"jetski"** (error strings printed to stderr literally start `jetski: ...` [OBS, 1]). So `agy` is the Windsurf/Cascade agent runtime, rebadged and shipped by Google. This matters because its on-disk formats are Cascade's (protobuf trajectories), not Gemini-CLI's.

**Distribution and platforms** [DOC, 8]:
- macOS (Apple Silicon + Intel, >= 12 Monterey), Windows (x64 + ARM64, Win10 64-bit+), Linux (x64 + ARM64, glibc >= 2.28).
- Installed via first-party install scripts (bash for Unix, PowerShell/CMD for Windows). **Not** an npm package — see §3.1.
- On this machine it is a **single 203 MB static binary** at `C:/Users/shaojiaxing/AppData/Local/agy/bin/agy.exe`, with no `node_modules`, no `package.json`, no sidecar JS [OBS].
- Self-update: `agy update` subcommand; state file `~/.gemini/antigravity-cli/updater/update_status.json` (observed content: `{"success":true,"message":"Already on the latest version."}`) [OBS]. The updater endpoint `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app` is embedded in the binary [BIN, 2]. `agy install` (re)configures PATH and shell aliases [OBS, 1].

**Release cadence / stability.** `agy changelog` prints a complete embedded changelog: **50 releases from 1.0.0 to 1.2.6** [OBS, 3]. The CLI surface is moving fast and headless-mode semantics specifically changed repeatedly (default print timeout changed 5 min -> unlimited in 1.2.6; exit-code semantics for tool errors changed in ~1.1.x; `--input-format stream-json` added mid-1.1.x) [OBS, 3]. Treat any flag behaviour as version-pinned.

#### Licensing / ToS — read this before anything else

Antigravity's Terms of Service, **Section 6 "Prohibited Conduct"**, states verbatim [DOC, 13]:

> "You must not abuse, harm, interfere with, or disrupt the Service. This includes, but is not limited to, using the Service in connection with products not provided by us. **Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement.** Such actions may be grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts."

This clause is in direct tension with the rest of the product: Google also ships an official **headless mode** doc with a "Drive a session programmatically" guide including a `subprocess.Popen` wrapper example [DOC, 7], and an official Python SDK for building on the agent [DOC, 14]. The narrow reading is "don't point a *different* agent harness at Antigravity OAuth credentials"; the broad reading covers any third-party UI driving the account. CloudCLI UI is a third-party product that would drive `agy` with the user's Antigravity OAuth session — it sits exactly on that line. **This is a policy decision for the maintainer, not a technical one, and it is the single biggest blocker.** No first-party text was found that explicitly blesses third-party front-ends.

**Quota model** [DOC, 15][16]: free Individual tier plus paid Google AI plans; weekly rolling rate limits on agent requests; "AI credits" act only as post-quota overage. The CLI exposes `/credits` and `/usage` panels interactively. Every `agy -p` turn consumes plan quota — a hosted multi-user UI would burn one account's weekly quota.

---

### 2. CLI surface

All of the following is **verbatim `--help` output from `agy.exe` 1.2.7 on this machine** [OBS, 1].

#### Global flags (`agy --help`)

| Flag | Description (verbatim) |
| --- | --- |
| `--add-dir` | Add a directory to the workspace (repeatable) (default []) |
| `--agent` | Agent for the current CLI session |
| `-c` | Short alias for `--continue` |
| `--continue` | Continue the most recent conversation |
| `--conversation` | Resume a previous conversation by ID |
| `--dangerously-skip-permissions` | Auto-approve all tool permission requests without prompting |
| `--disable-slash-commands` | Disable slash command and skill expansion in print mode |
| `--effort` | Reasoning effort for the current CLI session (low\|medium\|high) |
| `-i` | Short alias for `--prompt-interactive` |
| `--input-format` | Input format for print mode (text, stream-json). stream-json reads one NDJSON message per line from stdin and runs a turn for each; it requires `--output-format stream-json` (default text) |
| `--json-schema` | Optional JSON schema string or path to a schema file to enforce structured output (for stream-json, only applicable to the final result) |
| `--log-file` | Override CLI log file path |
| `--mode` | Set the agent execution mode for this session (accept-edits, plan) |
| `--model` | Model for the current CLI session |
| `--new-project` | Create a new project for this session |
| `--output-format` | Output format for print mode (text, json, stream-json) (default text) |
| `-p` / `--print` / `--prompt` | Run a single prompt non-interactively and print the response |
| `--print-timeout` | Optional time limit for print mode; 0 waits until the turn completes (default 0s) |
| `--project` | Project ID or project name for the current CLI session |
| `--prompt-interactive` | Run an initial prompt interactively and continue the session |
| `--remote-control` | Create a remote connection for the CLI session on start up |
| `--sandbox` | Run in a sandbox with terminal restrictions enabled |

#### Subcommands

| Subcommand | Purpose (verbatim) | Notes from `<sub> --help` |
| --- | --- | --- |
| `agent` / `agents` | List available agents | no flags beyond `-h`. Returned **empty output** on this machine [OBS] |
| `changelog` | Show changelog and release notes | prints full embedded changelog, 695 lines [OBS] |
| `help` | Show help for subcommands | `agy help --help` -> `Error: unknown subcommand: --help` |
| `install` | Configure environment paths and shell settings | `--dir`, `--skip-aliases`, `--skip-path` |
| `mcp` | Manage MCP servers (add, remove, list, enable, disable) | see §3.4 |
| `mic-serve` | Serve this machine's microphone to a CLI on another host | `--addr` (default `127.0.0.1:4713`) |
| `models` | List available models | no flags beyond `-h` |
| `plugin` / `plugins` | Manage plugins | `list`, `import [gemini\|claude]`, `install`, `uninstall`, `enable`, `disable`, `validate`, `link` |
| `remote-control` | Manage the remote-control background daemon | `start`, `status`, `stop` |
| `update` | Update CLI | `--help` prints only `Usage of update:` (no documented flags) |

Notable **negative finding**: the changelog claims `models` and `agents` gained an `--output-format` flag accepting `json`/`stream-json` [OBS, 3 line 298], but on 1.2.7 both reject it: `Error: flags provided but not defined: -output-format` [OBS]. Model enumeration is therefore **TSV-on-stdout only** in this build.

---

### 3. Facet-by-facet findings

#### 3.1 `runtime`

**Headless execution — fully supported and first-party documented.**

- `agy -p "<prompt>"` runs one non-interactive turn [OBS][DOC, 7].
- `--output-format` accepts `text` | `json` | `stream-json` [OBS, 1][DOC, 7].
- **Observed real `stream-json` run** (`agy -p "Reply with exactly the word: ok" --output-format stream-json`), NDJSON on stdout, 5 lines [OBS]:

```jsonc
{"event":"init","conversation_id":"<uuid>","init":{"cwd":"C:\\...\\agy-research","tools":["ask_custom_permission","ask_permission","ask_question","browser_click_element", ... 56 tools ... ,"write_to_file"],"permission_mode":"request-review"}}
{"event":"step_update","step_update":{"conversation_id":"<uuid>","step_index":0,"state":"DONE","step_type":"user_input"}}
{"event":"step_update","step_update":{"conversation_id":"<uuid>","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"ok"}}
{"event":"step_update","step_update":{"conversation_id":"<uuid>","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"\n","duration_seconds":1.357,"usage":{"input_tokens":13503,"output_tokens":49,"thinking_tokens":48,"cache_read_tokens":0,"total_tokens":13552}}}
{"event":"result","result":{"conversation_id":"<uuid>","status":"SUCCESS","response":"ok\n","duration_seconds":1.630,"num_turns":1,"usage":{...}}}
```

- Documented event vocabulary [DOC, 7]: events `init`, `step_update`, `result`; `step_update` fields `conversation_id`, `step_index`, `state` (`ACTIVE`/`DONE`), `step_type` (`user_input`, `agent_response`, `tool`, `checkpoint`), `tool_name`, `text_delta`, `duration_seconds`, `usage`, `tool_info`, `subagent_info`. `result.status` in {`SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`, `INVALID`, `WAITING`, `RUNNING`}. Note `step_type: "system_message"` also appears in practice [OBS] — the docs' list is not exhaustive on 1.2.7.
- `--output-format json` emits one object, observed verbatim [OBS]:
  `{"conversation_id":"...","status":"SUCCESS","response":"","duration_seconds":3.44,"num_turns":1,"usage":{"input_tokens":...,"output_tokens":...,"thinking_tokens":...,"cache_read_tokens":...,"total_tokens":...},"denied_actions":[{"action":"command","display_name":"RunCommand"}]}`

**Resume by session id — supported and verified.** `agy -p "<prompt>" --conversation <uuid> --output-format stream-json` reused the conversation, and `step_index` continued from 2 (not 0); `result.num_turns` became 2 and `usage` accumulated across turns [OBS]. `--continue`/`-c` resumes the most recent conversation in the cwd [OBS, 1].

**Multi-turn driving.** `--input-format stream-json` (requires `--output-format stream-json`) reads one NDJSON message per line from stdin and runs a turn per message, keeping one conversation open; closing stdin ends the session [OBS, 1][DOC, 7]. Input shape [DOC, 7]: `{ "event": "user", "message": { "content": "..." } }`, where `content` is a string or an array of blocks — **only `type: "text"` blocks are accepted; any other block type terminates the session with an error**.

**Permission / approval modes.** `permission_mode` reported in the `init` event (observed value `request-review`) [OBS]. Documented modes: `request-review`, `proceed-in-sandbox`, `always-proceed`, `strict` (settings key `toolPermission`) [DOC, 11]. `--mode accept-edits|plan` sets execution mode; `--dangerously-skip-permissions` auto-approves; `--sandbox` enables terminal sandboxing [OBS, 1]. **Observed default headless behaviour:** tools needing permission are *soft-denied*, the run still exits 0, and the denial is reported in `result.denied_actions` with a stderr notice naming the needed allow-rule [OBS]. Allow-rules go under `permissions.allow` in settings using patterns like `command(git)`, `read_file(path)`, `write_file(src/)` [DOC, 7][OBS, 6].

**Working directory.** The process cwd becomes `init.cwd` [OBS]. `--add-dir <path>` (repeatable) adds workspace roots — and, importantly, is what causes the session index to record a workspace (see §3.6) [OBS].

**Abort mid-flight.** Signal-driven: `result.status` has `CANCELED` and `INTERRUPTED` values, and closing stdin gracefully ends a streaming session [DOC, 7]. There is no `agy cancel <id>` subcommand [OBS]. Killing the child process is the mechanism — same as the existing Codex/Cursor runtimes.

**Image / file attachments.** Not available headlessly: stream-json input rejects non-`text` blocks [DOC, 7]; the interactive TUI has `Ctrl+V` "Paste media/clipboard" [DOC, 11], but no CLI flag for attaching an image was found in `--help` or the binary [OBS][BIN].

**SDK / npm package.** There **is** an official SDK, but it is **Python-only**: `pip install google-antigravity`, PyPI `google-antigravity` 0.1.17, Apache-2.0, `Development Status :: 3 - Alpha`, repo `github.com/Google-Antigravity/antigravity-sdk-python` [OBS, 10][DOC, 14]. The same repo URL is embedded in `agy.exe` [BIN, 2]. **No JS/TS/Node SDK exists** [DOC, 14]. npm has no first-party package: `@google/antigravity` -> 404; `antigravity` and `agy` on npm are unrelated 0.0.0 squatter placeholders [OBS, 10]. CloudCLI would have to spawn the `agy` binary as a subprocess, like its Codex/Cursor runtimes do — it cannot use an SDK the way the Claude provider does.

**Error reporting.** On agent/model API failure the CLI prints a structured `AGY_ERROR: {...}` JSON line on **stderr** (canonical status, HTTP/gRPC code, retryability, error id) and exits **3** [OBS, 3 v1.2.6].

**Verdict: Supported.** This is the strongest facet — a documented, typed NDJSON protocol with streaming deltas, usage accounting, resume-by-id and a stdin driver loop. Node integration is subprocess-only (no SDK).

#### 3.2 `models`

- `agy models` prints TSV `id<TAB>display name` [OBS]. Observed on 2026-09-21:
  `gemini-3.8-flash-{high,medium,low}`, `gemini-3.7-flash-{high,medium,low}`, `gemini-3.6-flash-{high,medium,low}`, `gemini-3.1-pro-{high,low}`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium` — 15 entries.
- Note the reasoning effort is **baked into the model id** (`-high`/`-medium`/`-low`) *and* separately settable via `--effort low|medium|high` [OBS].
- The list is **server-fetched and auth-gated**: the CLI prints "Fetching available models...", and when unauthenticated the log says `Auth mode is unspecified, skipping fetchAvailableModels and returning empty response` and the user-facing string is "Please sign in to view available models." [OBS, 5][BIN, 2]. A CloudCLI fallback model list would be required for the logged-out state.
- **No machine-readable output on 1.2.7** — `--output-format` is rejected (§2). Parsing would be tab-splitting stdout, which is brittle.
- **No context-window figure is exposed anywhere.** No per-model token limit appears in `agy models`, in any local config file, or as a plain string in the binary [OBS][BIN]. The binary has generic `max_token_limit` proto fields and a `custom_model_max_tokens_set` telemetry event, but no readable table [BIN, 2]. CloudCLI's per-model context-window declaration would have to be hardcoded.

**Verdict: Partial.** Enumeration works but only as TSV, requires login, and carries no context-window metadata.

#### 3.3 `auth`

- **Sign-in is an interactive OAuth browser flow against a Google account.** Endpoints in the binary: `https://antigravity.google/oauth/client-metadata.json`, `https://antigravity.google/oauth-callback`, `https://antigravity.google/auth-success` [BIN, 2]. There is **no `agy login` / `agy logout` subcommand** — only in-TUI `/login` and `/logout` [OBS, 1][DOC, 11]. First run with no args starts the sign-in flow ("No valid authentication found (%s). Starting login...") [BIN, 2].
- **Credentials are stored in the OS keyring**, not a JSON file: the binary contains `KeyringTokenStorage`, `wincred` (Windows Credential Manager) and `zalando/go_keyring` vendored packages, plus a documented **file-storage fallback** (`cliFileTokenStorage`, "Using file-based token storage because ...", used when the keyring times out or when a keyring-timeout marker was recorded recently, or on Linux hosts with no D-Bus session bus) [BIN, 2][OBS, 3]. The exact fallback file path could not be recovered from strings — **Unknown**.
- **Important: `~/.gemini/oauth_creds.json` on this machine belongs to the *Gemini CLI*, not to `agy`.** Its shape (redacted) is `{"access_token":"<redacted>","refresh_token":"<redacted>","scope":"<redacted>","token_type":"Bearer","id_token":"<redacted>","expiry_date":<number>}` [OBS, 4]. Do not treat it as `agy`'s credential store — `agy` shares the `~/.gemini` *parent directory* but keeps its own state under `~/.gemini/antigravity-cli/` and `~/.gemini/config/`.
- **Alternative auth paths** in the binary: `GEMINI_API_KEY` (a documented, supported mode — several changelog entries describe `GEMINI_API_KEY` sessions), `GOOGLE_GEMINI_BASE_URL`, and `AGY_ADC_AUTH` (Application Default Credentials) [BIN, 2][OBS, 3].
- **Can a headless server process use an existing login?** Yes, if it runs as the same OS user with keyring access — the observed `agy -p` runs on this machine authenticated silently from stored credentials. Caveats: on Linux containers/headless hosts the keyring is bypassed and file storage is used [OBS, 3 v1.1.x]; and OAuth code paste in print mode requires a controlling terminal (`/dev/tty` / `CONIN$`), with truly headless first-login failing fast with an actionable message [OBS, 3].
- **Checking login state non-interactively is awkward.** There is no status subcommand. Detectable signals: `agy models` returns an empty list when unauthenticated [OBS, 5]; `~/.gemini/antigravity-cli/log/cli-*.log` contains `You are not logged into Antigravity.` [OBS, 5]; `remote-control start` errors with `not signed in: run ..., sign in, then run ... remote-control start` [BIN, 2].

**Verdict: Partial.** Login works and persists for a same-user server process, but there is no scriptable login/status command and the credential store is an OS keyring rather than a file CloudCLI can inspect.

#### 3.4 `mcp`

**Supported, with a first-class CLI.** `agy mcp add|remove|list|enable|disable` [OBS, 1]. Observed `agy mcp list` output is a table: `NAME / TYPE / STATUS / COMMAND-URL`, e.g. `chrome-devtools-mcp  stdio  enabled  npx -y chrome-devtools-mcp@latest` [OBS].

`agy mcp add --help` verbatim [OBS, 1]:
```
Usage: agy.exe mcp add [flags] <name> <commandOrUrl> [args...]
  -e / --env      Environment variable KEY=value (repeatable)
  -H / --header   HTTP header Key: Value (repeatable)
  -t / --type     Server type: 'stdio' or 'http' (default stdio)
Notes: Flags must come before <name>. http/https URLs are detected automatically.
       Use -- before the command to pass a command or args that begin with '-'.
```

**Config file locations** [DOC, 9], both confirmed against the machine where applicable:

| Scope | Path |
| --- | --- |
| Global (CLI **and** IDE) | `~/.gemini/config/mcp_config.json` — **[OBS] exists, content matched `agy mcp list`** |
| Workspace | `<workspace>/.agents/mcp_config.json` |
| Plugin-bundled | `~/.gemini/antigravity-cli/plugins/<name>/mcp_config.json` |

**JSON shape** [DOC, 9]:
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
Observed minimal real file [OBS, 6]: `{"mcpServers":{"chrome-devtools-mcp":{"command":"npx","args":["-y","chrome-devtools-mcp@latest"]}}}`.

Two gotchas vs. CloudCLI's existing providers: remote servers use **`serverUrl`** — the docs state legacy `url`/`httpUrl` are *not* supported — and the disable switch is an inline **`"disabled": true`** field rather than a separate list. Discovered tool schemas are cached per server under `~/.gemini/antigravity-cli/mcp/<server>/<tool>.json` [OBS].

**Verdict: Supported.** Two scopes (`user` via `~/.gemini/config/mcp_config.json`, `project` via `<ws>/.agents/mcp_config.json`), transports `stdio` + `http`/`sse` (one `serverUrl` field covers both).

#### 3.5 `skills` / commands / rules

**Skills — supported, Claude-Code-shaped.** `SKILL.md` with YAML frontmatter (`description` required, `name` optional and defaulting to the folder name), auto-converted into `/<skill-name>` slash commands in the TUI [DOC, 10]. Slash commands and skills are also expanded in **print mode**, with `--disable-slash-commands` to opt out [OBS, 1][OBS, 3].

Discovery roots [DOC, 10], cross-checked on disk:

| Scope | Path | Observed? |
| --- | --- | --- |
| CLI global | `~/.gemini/antigravity-cli/skills/<skill>/` | **absent** on this machine |
| IDE global | `~/.gemini/config/skills/<skill>/` | **[OBS] present and populated** (4 user skills) |
| Workspace (CLI + IDE) | `<workspace>/.agents/skills/<skill>/` | not present here |
| Built-in | `~/.gemini/antigravity-cli/builtin/skills/<skill>/SKILL.md` | **[OBS] present** — `agy-customizations`, `antigravity_guide`, `generative_ui`, `migrate-workflows`, `permissioned-github` |
| Plugin-bundled | `~/.gemini/antigravity-cli/plugins/<name>/` | none installed |

[INF] The CLI appears to read the IDE's `~/.gemini/config/skills` too (that is the only populated global root here), but this was **not confirmed** by observing a skill being invoked — treat both global roots as candidates. Note the migration warning in the docs: skills under `.gemini/skills/` must be moved to `.agents/skills/` to be seen.

**Rules / memory files** [DOC, 12]:

| Scope | Path |
| --- | --- |
| Workspace rules | `<repo>/.agents/rules/*.md` (legacy `.agent/rules/` still read) |
| CLI global rules | `~/.gemini/antigravity-cli/rules/` |
| Global memory | `~/.gemini/GEMINI.md` — **[OBS] present on this machine** |
| Plugin rules | `~/.gemini/antigravity-cli/plugins/<name>/rules/` |

Rules are Markdown, capped at 12,000 characters each, evaluated during prompt expansion. `AGENTS.md` **is** referenced inside the binary (`AGENTS.md`, `rules/AGENTS.md`, `GEMINI.mdAGENTS.md` appear as adjacent strings [BIN, 2]) but the rules doc only names `GEMINI.md` [DOC, 12] — the exact `AGENTS.md` precedence is **Unknown**.

**Custom agents / subagents** [DOC, 18]: Markdown + YAML frontmatter at `<repo>/.agents/agents/<name>.md` or `.agents/agents/<name>/agent.md`; global at `~/.gemini/config/agents/<name>.md`; plugin-bundled at `plugins/<name>/agents/`. Frontmatter fields: `name`, `description`, `tools`, `mainAgent`, `subagent`, `model`, `commandExecutionPolicy`, `mcpServers`, `skills`, `plugins`; body = system prompt. Selected per-run with `--agent` [OBS, 1]. `agy agent` lists them (returned **empty** here — none defined) [OBS].

**Hooks/plugins** also exist (`.agents/hooks.json`, `agy plugin import gemini|claude`) [OBS, 1][BIN, 2].

**Verdict: Supported.** Directly mappable to CloudCLI's `SkillsProvider` with `/` command prefix; only ambiguity is which global root the CLI actually scans.

#### 3.6 `sessions`

**This is the facet that decides the integration, and the answer is better than expected: there are three usable artifacts, one of them plain JSONL.**

All under `~/.gemini/antigravity-cli/` (the CLI's app data dir; the IDE uses the sibling `~/.gemini/antigravity/`).

**(a) `conversations/<conversation-id>.db` — per-conversation SQLite, protobuf blobs. AVOID.**
One SQLite file per conversation. Schema (verbatim) [OBS]:
```sql
CREATE TABLE trajectory_meta (trajectory_id text, cascade_id text, trajectory_type integer, source integer, PRIMARY KEY(trajectory_id));
CREATE TABLE steps (idx integer, step_type integer NOT NULL DEFAULT 0, status integer NOT NULL DEFAULT 0,
  has_subtrajectory numeric, metadata blob, error_details blob, permissions blob, task_details blob,
  render_info blob, step_payload blob, step_format integer NOT NULL DEFAULT 0, PRIMARY KEY(idx));
CREATE TABLE gen_metadata (idx integer, data blob, size integer, PRIMARY KEY(idx));
CREATE TABLE executor_metadata (idx integer, data blob, PRIMARY KEY(idx));
CREATE TABLE parent_references (idx integer, data blob, PRIMARY KEY(idx));
CREATE TABLE trajectory_metadata_blob (id text DEFAULT "main", data blob, PRIMARY KEY(id));
CREATE TABLE battle_mode_infos (idx integer, data blob, PRIMARY KEY(idx));
```
Every payload column is **raw binary protobuf** with integer `step_type` discriminators (observed values 14, 15, 132, ...) [OBS]. Tool arguments happen to be JSON strings *inside* the proto, so grep-level extraction is possible but the envelope is not. The message names (`antigravity.localharness.StepUpdate`, `.TrajectoryStateUpdate`, `.ActionRunCommand`, `.ActionEditFile`, ...) are embedded as descriptors in the binary [BIN, 2], so a `.proto` could in principle be recovered from the Go descriptor tables — but that is real reverse engineering against a fast-moving closed format. **Do not build on this.**

**(b) `brain/<conversation-id>/.system_generated/logs/transcript.jsonl` — plain JSONL. USE THIS.**
[OBS] Verified on 27 existing conversations and on two conversations I created during this research. One JSON object per step, one line per `step_index`, exactly `step_count` lines. Observed field set:

```jsonc
{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE",
 "created_at":"2026-09-20T23:46:50Z","content":"<USER_REQUEST>...</USER_REQUEST><ADDITIONAL_METADATA>..."}
{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"...",
 "thinking":"...","tool_calls":[{"name":"run_command","args":{"CommandLine":"...","Cwd":"...","WaitMsBeforeAsync":"5000","toolAction":"...","toolSummary":"..."}}]}
{"step_index":2,"source":"MODEL","type":"GENERIC","status":"DONE","created_at":"...","content":"<tool result text>"}
{"step_index":3,"source":"SYSTEM","type":"SYSTEM_MESSAGE","status":"DONE","created_at":"...","content":"..."}
```
Observed enumerations [OBS]: `source` in {`USER_EXPLICIT`, `MODEL`, `SYSTEM`}; `type` in {`USER_INPUT`, `PLANNER_RESPONSE`, `GENERIC`, `SYSTEM_MESSAGE`}; `status` in {`DONE`, `RUNNING`}. Optional keys: `thinking`, `tool_calls[]`, `truncated_fields[]`. `created_at` is UTC RFC3339 (`...Z`) — verified against a local `+08:00` timestamp embedded in the same record. Tool **results** arrive as the following `MODEL`/`GENERIC` line's `content`; large outputs are additionally written to `.system_generated/steps/<idx>/output.txt` [OBS].
A sibling **`transcript_full.jsonl`** is the same records with nothing elided; `transcript.jsonl` truncates long `content`/`thinking` and names the elided keys in `truncated_fields` [OBS].
Both files are mirrored into `logs/chunks/transcript{,_full}/NNNNNNNN.jsonl` chunks that roll at exactly 102,400 bytes, and the top-level file is byte-exactly the concatenation of its chunks [OBS] — consistent with append-mode writing.

**(c) `conversation_summaries.db` — one shared SQLite index. USE THIS FOR THE LIST VIEW.**
Single table, **all plain columns, no blobs needed** [OBS]:
`conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status, source, project_id, agent_name, parent_conversation_id, nesting_depth, battle_id, winning_conversation_id, not_fully_idle, killed, last_user_input_time, last_user_input_step_index, app_data_dir, raw_summary (BLOB), group_id`.
96 rows here, indexing **both** the CLI (`app_data_dir='antigravity-cli'`, 33 rows) and the IDE (`app_data_dir='antigravity'`, 63 rows) — filter on `app_data_dir`. `status` values like `CASCADE_RUN_STATUS_IDLE`. Runs in **WAL mode** (`-wal`/`-shm` files present) [OBS]. `preview` is the first user prompt; `title` is often empty for short CLI runs (1.2.5+ deliberately skips the title-generating model call in headless runs [OBS, 3]).

**Workspace association — the one real gotcha, and it has a clean fix.** `workspace_uris` was **empty for 30 of 33 CLI conversations**, including one I created by simply running `agy -p` inside a directory. I then ran `agy -p "..." --add-dir <path>` and the row came back as `workspace_uris: ["file:///C:/Users/shaojiaxing/AppData/Local/Temp/agy-research/ws"]` [OBS — directly verified]. **Conclusion: CloudCLI must always pass `--add-dir <projectPath>` if it wants sessions to be attributable to a project.** A weaker secondary source exists: `~/.gemini/antigravity-cli/cache/last_conversations.json` maps `workspace path -> most recent conversation id` (one entry per workspace) [OBS]. `~/.gemini/antigravity-cli/cache/conversation_metadata.json` is a JSON mirror of the summary index with a `WorkspaceURIs` array, but on this machine it only held IDE conversations [OBS].

Other per-conversation artifacts [OBS]: `annotations/<id>.pbtxt` (protobuf text), `brain/<id>/{implementation_plan.md, walkthrough.md, task.md, *.metadata.json}` (agent artifacts), `brain/<id>/.system_generated/messages/*.json`, `presence/<id>.lock` (zero-byte liveness lock), `history.jsonl` at the root (only slash-command history: `{"display":"/model","timestamp":...,"workspace":"...","type":"slash_command"}`).

**Verdict: Supported** — via `transcript.jsonl` + `conversation_summaries.db`. **Not supported** via the per-conversation `.db` files, which are opaque protobuf.

#### 3.7 `sessionSynchronizer`

- **Scan root:** `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl` for content, plus `~/.gemini/antigravity-cli/conversation_summaries.db` (filtered to `app_data_dir='antigravity-cli'`) for metadata/title/preview/mtime — structurally the same shape as the existing OpenCode synchronizer, which already reads a shared SQLite DB and stores `jsonl_path` accordingly [17].
- **Tailing works.** Records are appended one line per step as the turn progresses; I watched a two-turn conversation grow from 2 to 5 lines with the earlier lines unchanged [OBS]. The chunk files rolling at a fixed 100 KiB and the top-level file equalling `concat(chunks)` is further evidence of append-mode writes [OBS].
- **Two caveats, both from first-party release notes** [OBS, 3]:
  1. **Context compaction rewrites the file.** v1.1.x fixed "corruption of the saved transcript when a background message appended to it while context compaction was rewriting it, which left malformed JSON that no longer parsed." A naive byte-offset tail will desync (and can read a torn line) after a compaction. A watcher must be able to fall back to a full re-read keyed on `step_index`.
  2. **`step_index` is the stable key, not line number** — `status:"RUNNING"` rows exist, and a step can be re-emitted as it transitions. Upsert on `(conversation_id, step_index)`.
- Live-session detection is available cheaply via `presence/<id>.lock` and the `not_fully_idle` / `status` columns [OBS].
- Because `conversation_summaries.db` is shared with the IDE, CloudCLI must **never delete it** — the same rule the OpenCode synchronizer already follows (`jsonl_path: null`) [17].

**Verdict: Supported**, with a re-read fallback required for compaction rewrites.

---

### 4. Blockers and unknowns

**Hard blockers**

1. **Terms of Service §6 (Prohibited Conduct).** *— superseded: see "ToS §6 — reassessed" in the Verdict section above; the risk was downgraded after establishing what the OpenClaw example actually refers to and how Google's own SDK is built.* "Using third party software, tools, or services to access the Service ... is a breach of this Agreement," with account suspension/termination named as the remedy [DOC, 13]. CloudCLI is third-party software driving the Service on the user's OAuth session. Google simultaneously documents headless programmatic driving [DOC, 7] and ships a programmatic SDK [DOC, 14], so the clause is arguably aimed at *alternative agent harnesses* rather than *front-ends for the official CLI* — but nothing first-party says so. **Get this resolved before writing code.** No other provider in CloudCLI carries a comparable clause.
2. **Quota is per-account and weekly.** Every turn spends plan quota [DOC, 15][16]; there is no API-key-billed path except `GEMINI_API_KEY`, which is a different (Gemini API) product surface.

**Soft blockers / extra work**

3. **No Node SDK.** Subprocess-only integration; the SDK that exists is Python and `Development Status :: 3 - Alpha` [OBS, 10].
4. **`agy models` has no machine-readable mode on 1.2.7** despite the changelog claiming one — TSV parsing, auth-gated, and **no context-window numbers at all**. CloudCLI's per-model context window would be hardcoded.
5. **No scriptable auth-status check**; credentials live in the OS keyring. Login state must be inferred (empty `agy models`, or the `You are not logged into Antigravity.` log line).
6. **Sessions are only project-attributable if `--add-dir` is passed** — verified. Sessions started without it land in `default-cli-project` with empty `workspace_uris`, so pre-existing user sessions created outside CloudCLI will mostly be unattributable.
7. **`conversation_summaries.db` is shared with the Antigravity IDE** — read-only, filter on `app_data_dir`, never delete.
8. **Compaction rewrites `transcript.jsonl`** — the synchronizer needs a full-re-read fallback rather than pure byte-offset tailing.
9. **No headless image/file attachments** — stream-json input accepts `text` blocks only.
10. **Surface churn.** 50 releases 1.0.0 -> 1.2.6, with headless semantics (timeouts, exit codes, slash-command handling) changing repeatedly. Note also that the changelog embedded in the 1.2.7 binary tops out at 1.2.6, so 1.2.7's own changes are undocumented locally.

**Unknowns (stated as unknown, not guessed)**

- Exact path/format of the **file-based token storage fallback** when the OS keyring is unavailable. `cliFileTokenStorage` exists in the binary but no path string was recoverable.
- Which **global skills root** the CLI actually scans: docs say `~/.gemini/antigravity-cli/skills/`, but only `~/.gemini/config/skills/` is populated here and it was never observed being loaded.
- Whether **`AGENTS.md`** is honoured by the CLI as a rules file, and with what precedence relative to `GEMINI.md` and `.agents/rules/`. The string exists in the binary; the rules doc names only `GEMINI.md`.
- The `.proto` schema for `antigravity.localharness.*` step payloads (recoverable from the Go descriptor tables with effort; not attempted).
- Whether `--project` / `--new-project` gives a better project->session key than `--add-dir`; all CLI conversations here sat in `default-cli-project`.
- Whether a second `agy` process can safely attach to / observe a conversation another process is actively running (the `presence/*.lock` files suggest exclusivity, untested).
- Whether the `step_type` vocabulary in the stream-json docs is closed — `system_message` was observed and is not in the documented list.

---

### 5. Sources

Type key: **[BINARY]** the shipped `agy.exe` or its extracted strings; **[LOCAL]** a file `agy`/Antigravity wrote on this machine; **[CMD]** live output of a command run during this research; **[URL]** first-party web page or registry.

1. **[CMD]** `agy --help`, `agy <sub> --help` for all 11 subcommands, `agy mcp {add,list,remove,enable,disable} --help`, `agy --version` -> `1.2.7`. Binary: `C:/Users/shaojiaxing/AppData/Local/agy/bin/agy.exe` (203,523,736 bytes).
2. **[BINARY]** Printable-string extraction of the full `agy.exe` (39.6 MB of strings) — proto descriptor names (`antigravity.localharness.*`, `exa.*`), Go symbol paths (`google3/third_party/jetski/...`), embedded URLs, env-var names (`GEMINI_API_KEY`, `AGY_ADC_AUTH`, `AGY_ERROR`, `GOOGLE_GEMINI_BASE_URL`, `ANTIGRAVITY_*`), keyring/token-storage symbols.
3. **[CMD]** `agy changelog` — 695 lines, 50 releases 1.0.0 -> 1.2.6 (also embedded in the binary).
4. **[LOCAL]** `C:/Users/shaojiaxing/.gemini/oauth_creds.json` — shape only, all values redacted. **Belongs to the Gemini CLI, not to `agy`.** Also `~/.gemini/settings.json`, `~/.gemini/projects.json`.
5. **[LOCAL]** `~/.gemini/antigravity-cli/cli.log` and `~/.gemini/antigravity-cli/log/cli-*.log` — auth-state lines (`You are not logged into Antigravity.`, `Auth mode is unspecified, skipping fetchAvailableModels`).
6. **[LOCAL]** `~/.gemini/config/mcp_config.json`, `~/.gemini/config/config.json`, `~/.gemini/config/projects/*.json`, `~/.gemini/config/skills/*/SKILL.md`, `~/.gemini/antigravity-cli/settings.json`, `~/.gemini/antigravity-cli/builtin/skills/*/SKILL.md`, `~/.gemini/antigravity-cli/cache/{onboarding,last_conversations,conversation_metadata}.json`, `~/.gemini/antigravity-cli/{history.jsonl,jetski_state.pbtxt,updater/update_status.json}`, `~/.gemini/antigravity-cli/mcp/<server>/<tool>.json`.
   **[LOCAL]** Session storage: `~/.gemini/antigravity-cli/conversations/*.db` (schema dumped via `better-sqlite3` on temp copies), `~/.gemini/antigravity-cli/conversation_summaries.db` (96 rows), `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript{,_full}.jsonl` + `chunks/`, `.../steps/<idx>/output.txt`, `~/.gemini/antigravity-cli/presence/*.lock`.
   **[CMD]** Live runs performed for this research (4 agent turns + 6 slash-command turns, roughly 130k input tokens total): `agy -p ... --output-format json`, `agy -p ... --output-format stream-json`, the same resumed with `--conversation <uuid>`, and one with `--add-dir` to prove workspace attribution.
7. **[URL]** https://antigravity.google/docs/cli/headless/ — headless mode reference: flags, stream-json output event schema, stdin input schema, status values, permission behaviour, exit codes.
8. **[URL]** https://antigravity.google/docs/getting-started?tab=cli — product description, platform matrix, install methods.
9. **[URL]** https://antigravity.google/docs/mcp/ — MCP config paths and full JSON field list.
10. **[URL]** https://registry.npmjs.org/{antigravity,agy,@google%2Fantigravity} (404 / unrelated placeholders) and https://pypi.org/pypi/google-antigravity/json (v0.1.17, Apache-2.0, alpha).
11. **[URL]** https://antigravity.google/docs/cli/reference — slash commands, keybindings, `settings.json` keys and defaults.
12. **[URL]** https://antigravity.google/docs/rules-workflows/ — rules file paths, 12,000-char cap, precedence.
13. **[URL]** https://antigravity.google/terms — Section 6 "Prohibited Conduct", third-party-client clause (quoted verbatim in §1).
14. **[URL]** https://antigravity.google/docs/sdk/overview/ and https://github.com/Google-Antigravity/antigravity-sdk-python — Python-only SDK.
15. **[URL]** https://antigravity.google/docs/cli/credits/ — AI credits, `/credits`, `/usage`, `useG1Credits`.
16. **[URL]** https://antigravity.google/docs/plans/ (via search-result summary) — plan tiers and weekly rate limits. *Lower confidence: read through a search summary, not fetched directly.*
17. **[LOCAL, this repo]** `D:/code/opensource/claudecodeui/server/modules/providers/README.md` — the 7-facet provider contract this report measures against.
18. **[URL]** https://antigravity.google/docs/subagents/ — custom agent file paths and frontmatter fields.

---

**Sources added 2026-09-21 (follow-up on ToS and SDK availability):**

- [18] VentureBeat, "Google clamps down on Antigravity 'malicious usage', cutting off OpenClaw users in sweeping ToS enforcement move" — <https://venturebeat.com/orchestration/google-clamps-down-on-antigravity-malicious-usage-cutting-off-openclaw-users> (secondary; used only for what Google told affected users)
- [19] openclaw/openclaw issue #14203, "Google banning accounts for using OpenClaw with Antigravity/Gemini CLI" — <https://github.com/openclaw/openclaw/issues/14203> (primary for the affected side)
- [20] Google AI Developers Forum thread on the ban wave — <https://discuss.ai.google.dev/t/250-mo-ultra-subscriber-banned-without-warning-the-openclaw-mass-ban-wave-shows-a-systemic-failure-in-googles-developer-support/123015> (first-party-hosted forum)
- [21] Official Python SDK source, `Google-Antigravity/antigravity-sdk-python` — <https://github.com/Google-Antigravity/antigravity-sdk-python>; transport facts read directly from `google/antigravity/connections/local/local_connection.py` and `google/antigravity/connections/README.md` (primary, source code)
- [22] npm registry queries for `@google/antigravity`, `antigravity`, `agy`, `antigravity-sdk` against `registry.npmjs.org` (primary, registry metadata)
- [23] Official SDK protobuf definitions, Apache-2.0 — `google/antigravity/proto/*.proto` (25 files) in `Google-Antigravity/antigravity-sdk-python`, notably `localharness.proto` and `steps.proto`; plus `examples/getting_started/app_data_dir_override.py` (primary, source code)
- [24] `AGY_*` environment-variable names extracted from the installed `agy.exe` 1.2.7 binary (primary, binary strings)

## Part B — cost of adding provider #5 to this repo

Scope: read-only survey. No production code written. All numbers below are
either a command output or a `path:line` citation; anything not measured is
marked "not measured".

Repo: `D:/code/opensource/claudecodeui`, branch `dev`, surveyed 2026-09-21.

### 1. The facet contract

Source: `server/modules/providers/README.md:10-28`, `server/shared/interfaces.ts`.

Every provider implements 7 facets, matched to interfaces in
`server/shared/interfaces.ts`:

| Facet | Interface | Required methods | Optional methods |
| --- | --- | --- | --- |
| `runtime` | `IProviderRuntime` (interfaces.ts:31-40) | `run(command, options, writer, context)`, `abort(sessionId)` | `permissions` (a `ProviderRuntimePermissionGateway`) |
| `models` | `IProviderModels` (98-114) | `getSupportedModels()`, `getCurrentActiveModel(sessionId?)` | none |
| `auth` | `IProviderAuth` (124-129) | `getStatus()` | none |
| `skills` | `IProviderSkills` (140-158) | `listSkills(options?)`, `addSkills(input)`, `removeSkill(input)` | none |
| `mcp` | `IProviderMcp` (168-175) | `listServers`, `listServersForScope`, `upsertServer`, `removeServer` | none |
| `sessions` | `IProviderSessions` (185-230) | `normalizeMessage(raw, sessionId)`, `fetchHistory(sessionId, options?)` | `forkSession`, `resolveEditAnchor`, `rewindSession` — each interface doc says its *absence* is what disables that UI feature (fork / edit-message / provider-side rewind) |
| `sessionSynchronizer` | `IProviderSessionSynchronizer` (242-252) | `synchronize(since?)`, `synchronizeFile(filePath)` | none |

Two more things sit above the 7 facets:

- `IProvider.fork?` (interfaces.ts:48-63) — a whole optional 8th facet (`IProviderFork.forkSession`), present only on providers that can materialize a transcript prefix as a new resumable session.
- `AbstractProvider` (`server/modules/providers/shared/base/abstract.provider.ts:19-28`) marks `runtime`, `models`, `mcp`, `auth`, `skills`, `sessions`, `sessionSynchronizer` as `abstract readonly` — all 7 are structurally mandatory at the TypeScript level (the class won't compile without them), even though several of their *methods* are optional or can be stub implementations.

Two shared base classes remove most of the boilerplate for 2 of the 7 facets:
- `McpProvider` (`server/modules/providers/shared/mcp/mcp.provider.ts`, 151 lines) — a subclass supplies exactly 4 abstract methods (`readScopedServers`, `writeScopedServers`, `buildServerConfig`, `normalizeServerConfig`; lines 114-129); everything else (scope/transport validation) is shared.
- `SkillsProvider` (`server/modules/providers/shared/skills/skills.provider.ts`, 287 lines) — a subclass supplies exactly 1 abstract method, `getSkillSources(workspacePath)` (line 282); markdown/frontmatter parsing is shared.

No equivalent shared base exists for `runtime`, `sessions`, or `sessionSynchronizer` — those are fully provider-owned (see §5).

### 2. Existing providers by the numbers

Command: `find server/modules/providers/list/<p> -type f | xargs wc -l | sort -n`, run for all four providers.

| Provider | runtime | sessions | models | mcp | auth | session-sync | skills | provider.ts | fork/rewind/extras | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude | 1465 (`.js`) | 1214 | 326 | 135 | 180 | 203 | 268 | 33 | 43(custom-endpoint)+57(fork)+65(rewind)+82(anchors)+117(background-work)+354(turn-reuse) = 718 | **4542** |
| codex | 560 (`.ts`) + 243 (app-server client) = 803 | 2267 | 139 | 135 | 100 | 212 | 73 | 33 | 40 (fork) | **3802** |
| cursor | 387 (`.js`) | 654 | 119 | 108 | 143 | 158 | 39 | 30 | 0 | **1638** |
| opencode | 757 (`.js`) + 164 (serve process) = 921 | 721 | 476 | 228 | 110 | 179 | 78 | 30 | 102(rewind)+139(anchors) = 241 + 873 test file | **3857** (3857 incl. its own runtime test; 2984 excl. test) |

Full per-file breakdown (from the raw command output):

- **claude**: `claude-runtime.provider.js` 1465, `claude-sessions.provider.ts` 1214, `claude-turn-reuse.ts` 354, `claude-models.provider.ts` 326, `claude-skills.provider.ts` 268, `claude-session-synchronizer.provider.ts` 203, `claude-auth.provider.ts` 180, `claude-mcp.provider.ts` 135, `claude-background-work.ts` 117, `claude-anchors.ts` 82, `claude-rewind.ts` 65, `claude-fork.provider.ts` 57, `claude-custom-endpoint.ts` 43, `claude.provider.ts` 33.
- **codex**: `codex-sessions.provider.ts` 2267, `codex-runtime.provider.ts` 560, `codex-app-server.client.ts` 243, `codex-session-synchronizer.provider.ts` 212, `codex-mcp.provider.ts` 135, `codex-models.provider.ts` 139, `codex-auth.provider.ts` 100, `codex-skills.provider.ts` 73, `codex.provider.ts` 33, `codex-fork.provider.ts` 40.
- **cursor**: `cursor-sessions.provider.ts` 654, `cursor-runtime.provider.js` 387, `cursor-session-synchronizer.provider.ts` 158, `cursor-auth.provider.ts` 143, `cursor-models.provider.ts` 119, `cursor-mcp.provider.ts` 108, `cursor-skills.provider.ts` 39, `cursor.provider.ts` 30. (No fork/rewind/anchors files — cursor has none of those capabilities, consistent with §5/§6 capability matrix.)
- **opencode**: `opencode-runtime.provider.js` 757, `opencode-runtime.provider.test.js` 873 (co-located test, unlike the other 3 providers which keep tests in `tests/`), `opencode-sessions.provider.ts` 721, `opencode-models.provider.ts` 476, `opencode-mcp.provider.ts` 228, `opencode-session-synchronizer.provider.ts` 179, `opencode-serve.ts` 164, `opencode-anchors.ts` 139, `opencode-auth.provider.ts` 110, `opencode-skills.provider.ts` 78, `opencode.provider.ts` 30, `opencode-rewind.ts` 102.

**What drives the spread:**
- `sessions` is the single biggest line-count driver everywhere (654-2267 lines) — it is 100% provider-specific parsing/normalization of a native on-disk transcript format (see §5).
- codex's `sessions` file (2267 lines) is the largest in the repo — codex's native format is app-server JSON-RPC over a long-lived process (`codex-app-server.client.ts`, 243 lines, is a dedicated RPC client that only codex needs), which pushes far more protocol-shape logic into the sessions layer than the other three providers' flat JSONL/SQLite reads.
- claude's total is inflated by optional advanced features no other provider (except opencode, partially) has: `claude-turn-reuse.ts` (354, reusing a live process across a same-settings follow-up prompt) and `claude-background-work.ts` (117, tracking async background tool work) have no equivalent in codex/cursor/opencode at all.
- `models` varies 119-476 lines: opencode's 476-line file reflects a wide, frequently-changing upstream model catalog (confirmed by commit message "fix: format opencode model catalog labels ... keeps OpenCode usable as its model list expands across many upstream [models]" in `374e9de7`), vs. cursor/codex's more fixed, small catalogs.
- cursor is the thinnest provider (1638 total) — no fork, no rewind, no anchors, no turn-reuse, no background-work, no custom-endpoint routing.

### 3. Empirical cost of the last provider added

The most recently *created* provider directory is `opencode` (confirmed by
`git log --oneline --diff-filter=A -- "server/modules/providers/list/<p>"`
for all four — opencode's earliest add-commit is `374e9de7`, all others
predate it: cursor/codex/claude directories were created in
`49dd3cfb`/`44edf94f`, before opencode existed).

**Caveat — this is not a clean "add one provider" diff.** `374e9de7` ("feat: add
opencode support (#762)") is a squash-merged PR (its body lists ~10 sub-commits:
initial add, session-startup stabilization, session-id-race fix, onboarding
wiring, model-label formatting, etc.) and it bundles unrelated work: a `gemini`
provider stub (`gemini-models.provider.ts` +42, `gemini.provider.ts` +3 — never
became a 5th provider in the current tree, `server/modules/providers/list/`
has no `gemini/` directory today), a 731-line new `CommandResultModal.tsx`
component, an 841-line `public/modelConstants.js`, and a 384-line addition to
`server/shared/utils.ts`. Full stat: **87 files changed, 7025 insertions(+),
578 deletions(-)** (`git show --stat 374e9de7`).

Isolating what is unambiguously opencode-specific (its own directory plus its
own tests/CLI wrapper/logo, scoped with `git show --stat 374e9de7 -- <paths>`):

| File | Lines |
| --- | --- |
| `server/modules/providers/list/opencode/opencode-sessions.provider.ts` | +463 |
| `server/modules/providers/list/opencode/opencode-models.provider.ts` | +339 |
| `server/modules/providers/list/opencode/opencode-mcp.provider.ts` | +228 |
| `server/modules/providers/list/opencode/opencode-session-synchronizer.provider.ts` | +157 |
| `server/modules/providers/list/opencode/opencode-auth.provider.ts` | +111 |
| `server/modules/providers/list/opencode/opencode-skills.provider.ts` | +78 |
| `server/modules/providers/list/opencode/opencode.provider.ts` | +27 |
| `server/modules/providers/tests/opencode-sessions.test.ts` | +321 |
| `server/modules/providers/tests/opencode-models.test.ts` | +73 |
| `server/opencode-cli.js` (pre-module-refactor runtime location) | +263 |
| `server/opencode-cli.test.js` | +95 |
| `src/components/llm-logo-provider/OpenCodeLogo.tsx` (now `src/shared/ui/OpenCodeLogo.tsx`) | +25 |
| **Subtotal, unambiguously opencode-specific** | **~2180** |

This subtotal (2180 lines, one PR, one author, merged 2026-05-28 per
`git log -1 --format=%ai 374e9de7`) is the best available empirical
"new provider, first cut" number — it does **not** include the outside-dir
touchpoints in §4 (registry wiring, type unions, UI pickers, i18n), which are
mixed into the same commit's other ~4800 lines and cannot be cleanly
separated from the concurrent onboarding/model-catalog refactor in that PR.
Three follow-up commits then added fork/rewind support to opencode
specifically (`e9e0c190`, `7c8ce2ce`, `f0044534` — not measured individually;
these post-date the initial add by enough that they read as separate,
later-scoped features rather than part of the original provider cost).

### 4. Touchpoints outside the provider dir

Method: `grep -rl` for each of `opencode`, `cursor`, `codex` across
`server/` and `src/` (`.ts .tsx .js .jsx .json`), excluding each provider's
own `list/<p>/` directory, then intersected with `comm -12` three ways. The
intersection (54 files) is the set every existing provider appears in — the
true "a new provider must touch this" list, independent of which provider you
pick as your reference.

| Category | Files (of the 54) | ~Lines (per-provider marginal, not file total) | Mechanical? |
| --- | --- | --- | --- |
| Provider registry / backend wiring | `server/modules/providers/provider.registry.ts` (36 lines total, +2/provider, see §5 registry snippet), `server/modules/providers/provider.routes.ts` (996 lines, 1 opencode hit — `provider.routes.ts:291`), `server/modules/agent/agent.routes.ts` (11 opencode hits: type field, runner wiring, allow-list checks at `agent.routes.ts:899-900`, spawn branch at `:1018-1025`), `server/index.ts` (2 hits: `index.ts:118` runner resolve, `:127` dependency wiring) | ~20-30 | Mechanical — same shape repeated per provider, TS compiler flags missing entries in `Record<LLMProvider,...>` maps |
| `LLMProvider` union types | `server/shared/types.ts:69`, `src/shared/types.ts:8` | 2 (one union member each) | Mechanical, but this single edit is what makes the TS compiler start flagging every other missing spot |
| DB schema | `server/modules/database/schema.ts:189` — `provider TEXT NOT NULL CHECK (provider IN ('claude','cursor','codex','opencode'))` | 1 line changed, but requires a migration | Mechanical text, **not** mechanical to ship — sqlite `CHECK` constraints need a real migration (table rebuild or constraint drop/recreate) per `server/modules/database/migrations.ts` conventions, not a one-line edit in place |
| Frontend provider pickers / constants | `src/shared/constants.ts` — 5 separate `Record<LLMProvider/McpProvider, X>` maps each need one new key: `MCP_PROVIDER_NAMES` (:118-123), `MCP_SUPPORTED_SCOPES` (:126-131), `MCP_SUPPORTED_TRANSPORTS` (:134-139), `MCP_SUPPORTS_WORKING_DIRECTORY` (:145-150), `PROVIDER_PERMISSION_PREFERENCE_KEYS` (:215-220); `src/modules/chat/hooks/useChatProviderState.ts` (5 opencode hits: effort levels :24, default model :35, `PROVIDERS` array :38, permission modes :53, edit-restore comment :317); `src/modules/chat/transcript/ProviderSelectionEmptyState.tsx` (id/name list :34, display-name switch :81, i18n-keyed ready prompt :325-327) | ~10-15 one-line map entries + ~15-line switch/array additions | Mechanical — copy-paste-rename an existing entry in each map |
| Icons/logos | `src/shared/ui/LLMProviderLogo.tsx` (:25-26, one `if` branch dispatching to a dedicated logo component), plus a new `<Provider>Logo.tsx` file (opencode's is 25 lines) | ~30 (new file) + 2 (dispatch) | Mechanical wiring, but the logo asset itself needs real design/sourcing work (not mechanical) |
| Provider-auth UI | `src/modules/provider-auth/ProviderLoginModal.tsx` (2 hits: CLI login command string :58-59, modal title :69) | ~5 | Mechanical if the provider's CLI login command is already known; otherwise needs the candidate-CLI research this task explicitly excludes |
| MCP UI | `src/modules/mcp/McpServers.tsx` (:23, one Tailwind class-map entry) | 1 | Mechanical |
| Settings / model-library UI | `src/modules/settings/tabs/agents-settings/AgentsSettingsTab.tsx`, `.../sections/AgentSelectorSection.tsx`, `.../sections/content/AccountContent.tsx`, `.../sections/AgentCategoryContentSection.tsx`, `src/modules/chat/modals/ModelLibraryPanel.tsx`, `src/modules/onboarding/AgentConnectionsStep.tsx`, `src/modules/skills/ProviderSkills.tsx` | not individually measured; each is a small per-provider branch/entry based on the pattern seen elsewhere | Mostly mechanical, some (onboarding copy, category grouping) needs a judgment call on where the provider "belongs" in the UI |
| Commands / slash-command routing | `server/modules/commands/commands.routes.ts` (:31 `MODEL_PROVIDERS` array, :37 display-name map) | 2 | Mechanical |
| i18n locale files | 10 files hit for opencode: `en`, `es`, `fr`, `ko`, `zh-CN` × {`chat.json`, `settings.json`}. **Repo has 11 locales total** (`de es en fr it ja ko ru tr zh-CN zh-TW` — `ls src/modules/i18n/locales`); **6 of them (`de, it, ja, ru, tr, zh-TW`) never received an opencode string at all** and are missing the `globalAddDescription`/`globalModalDescription` keys entirely (`grep -n globalAddDescription` returns nothing for any of the 6) — those locales are already stale independent of any new provider. Per-locale key count for the 5 that do have it: `en` chat=2 hits/settings=5 hits, `es/fr/ko/zh-CN` chat=2/settings=3 each. | ~5-10 short strings × 5 actively-maintained locales = ~25-50 lines if you match what opencode got; 0 if you match the de/it/ja/ru/tr/zh-TW precedent of skipping it | Mechanical per string, but this exposes a real gap: there is no enforced "all locales updated" check, so a new provider can (and per opencode's own precedent, did) ship without 6 of 11 languages |
| Tests | Shared cross-provider test files hit by all of opencode/cursor/codex: `server/modules/providers/tests/{mcp,skills,provider-capabilities.service,provider-models.service,provider-runtime.service,provider-token-usage.service}.test.ts`, `server/modules/websocket/tests/chat-run-registry.test.ts`, `server/modules/agent/tests/agent.routes.test.ts`, `src/modules/chat/tests/{chatProviderModels,composerToolsSettingsResolution}.test.ts`, `src/modules/git-panel/tests/selectedProviderSync.test.tsx` — 11 shared files. Provider-owned test files are separate and larger (opencode: `opencode-sessions.test.ts` +321, `opencode-models.test.ts` +73, `opencode-runtime.provider.test.js` 873 lines in the current tree). | Shared files: a few lines/test-case each. Owned files: several hundred lines, see §2/§3. | Shared-file edits are mechanical (add a case to an existing loop/table); the owned provider test files require real understanding of the provider's native format |
| Docs | `docs/adr/0004, 0005, 0006, 0008, 0009, 0011` (capability-decision ADRs that name opencode specifically), `docs/architecture/02-realtime-stream.md`, `docs/architecture/03-conversation-handoff.md`, `docs/architecture/04-message-store-and-lazy-loading.md`, `docs/fork-customizations.md` + `.zh-CN.md` | not measured (prose, not LOC-meaningful) | Not mechanical — each ADR records a real design decision (e.g. why codex can't fork, why opencode's rewind is "reported not recovered") that only exists because someone had to think through the new provider's actual capabilities |

### 5. Per-facet difficulty for a new provider

| Facet | Rating | Why |
| --- | --- | --- |
| `auth` | **trivial** | Single `getStatus()` call, ~100-180 lines across all 4 providers (`claude-auth.provider.ts` 180, `codex-auth.provider.ts` 100, `cursor-auth.provider.ts` 143, `opencode-auth.provider.ts` 110). Mostly "is the CLI on PATH / does a credentials file exist" checks. README explicitly allows a stable "not installed" stub (README.md:124). |
| `mcp` | **trivial-to-moderate** | Shared `McpProvider` base class (151 lines) does scope/transport validation; a new provider implements exactly 4 methods (`mcp.provider.ts:114-129`). The only real work is learning the provider's native config file format (see README's existing-formats table, README.md:140-145) — moderate only if that format is undocumented. |
| `skills` | **trivial** | Shared `SkillsProvider` base class (287 lines) does frontmatter parsing; a new provider implements exactly `getSkillSources()` (skills.provider.ts:282), returning root directories. Existing implementations are 39-268 lines, with claude's 268 being the outlier because it also discovers plugin-scoped skills. |
| `models` | **trivial-to-moderate** | Two methods: a static catalog (`getSupportedModels`) and a best-effort live lookup (`getCurrentActiveModel`, README.md:105-113 notes it's read-only and can fall back to a default). Size (119-476 lines) tracks how volatile/large the provider's real model list is, not inherent difficulty. |
| `sessionSynchronizer` | **moderate-to-hard** | Two methods (`synchronize`, `synchronizeFile`) but each is a from-scratch parser for the provider's native on-disk session-artifact format (JSONL directory tree for claude/codex/cursor, a shared SQLite DB for opencode — README.md:203-210). opencode's synchronizer (179 lines) had to special-case that its DB is *shared* with the opencode CLI itself, storing `jsonl_path: null` so deleting an app-tracked session can't delete the shared DB (README.md:210) — this kind of "the CLI's storage isn't ours to touch" discovery is exactly the unmeasurable, provider-specific risk this facet carries. |
| `sessions` | **hard** | Consistently the largest file per provider (654-2267 lines, §2) and 100% provider-specific. `normalizeMessage` alone in opencode is ~320 lines (`opencode-sessions.provider.ts:281-600+`) handling many distinct raw event/part shapes (text, tool-call, reasoning, ...), each converted via `createNormalizedMessage`/`generateMessageId` into the repo's canonical `NormalizedMessage[]` shape. `fetchHistory` must also get pagination semantics exactly right (README.md:181-184: `limit: null` = unbounded, `limit: 0` = empty page, always return `total/hasMore/offset/limit`) — the README calls out "treating `limit === 0` as unbounded" as a *common mistake* (README.md:373), i.e. a real place people got this wrong before. The optional `forkSession`/`resolveEditAnchor`/`rewindSession` methods (interfaces.ts:197-229) are each their own multi-file feature when implemented (claude's fork/rewind/anchors alone: 57+65+82 = 204 lines; opencode's: 102+139 = 241 lines) — can be skipped entirely for an MVP (see §6). |
| `runtime` | **hard** | No shared base class at all. Must spawn/drive the provider's CLI or SDK, stream its native stdout/event format, and convert it live into the repo's writer/context contract (`run(command, options, writer, context)`, interfaces.ts:32-37) while also implementing `abort`. opencode's runtime (757 lines, `opencode-runtime.provider.js`) covers: process spawn AND an alternate `opencode serve` HTTP-server mode (`opencode-serve.ts`, 164 lines) with its own base-URL handshake (`startOpenCodeServeProcess`, runtime.provider.js:245), permission-mode mapping (`resolveOpenCodePermissionOptions`, :39-50), a "compact" side-channel RPC (`runOpenCodeCompactSideChannel`, :308-443, ~135 lines on its own), token-usage extraction (`readOpenCodeTokenUsage`, :68), and process-tree teardown on abort (`killOpenCodeProcessTree`, :186). This is the facet where a candidate CLI's own design (does it have a stable JSON event stream? a long-lived server mode? reliable abort semantics?) — which this survey was told not to investigate — will swing the estimate the most. |

**Graceful degradation is a real, designed-in mechanism, not a hope.** `server/modules/providers/services/provider-capabilities.service.ts` (169 lines) is a static `Record<LLMProvider, ProviderCapabilities>` (capabilities.service.ts:65 onward) that the frontend reads instead of branching on provider id in components (file header comment, capabilities.service.ts:6-9). It already carries real, current gaps per existing provider — e.g. cursor has `supportsPermissionRequests: false, supportsTokenUsage: false, supportsEffort: false, supportsCompact: false, supportsFork: false, supportsClear: false, supportsMessageEditing: false, supportsSessionForking: false` (capabilities.service.ts:90-107) — proving a provider can ship today supporting only the baseline chat loop with every advanced feature turned off, and the UI already knows how to hide/disable those controls per provider rather than assuming feature parity.

### 6. Minimum viable provider

Structurally required by `AbstractProvider` (all 7 facets, §1) — but each can
be a thin/stub implementation for a first cut:

- **runtime**: full implementation, unavoidable — without it there's no chat loop at all. This is the true floor of "does it work."
- **sessions**: `normalizeMessage` + `fetchHistory` unavoidable (used by every chat render); the 3 optional methods (`forkSession`, `resolveEditAnchor`, `rewindSession`) can all be omitted — `provider-capabilities.service.ts` already has a working precedent for a provider (cursor) with all three off.
- **sessionSynchronizer**: per README's own minimal template (README.md:299-311), `synchronize`/`synchronizeFile` can both be no-op stubs returning `0`/`null` — session history simply won't be indexed from disk until implemented for real.
- **auth**: minimal stub returning a stable "not installed"/"not authenticated" status is explicitly sanctioned (README.md:124).
- **mcp**, **skills**: cannot be typed away (no `?` in `IProvider`, abstract.provider.ts:22-26) — but the shared base classes mean an honest "this provider has no MCP servers / no skills yet" implementation is ~10-20 lines (return empty arrays from `readScopedServers`/`getSkillSources`, throw or no-op on write).
- **models**: `getSupportedModels()` needs at least one real entry (the runtime needs a model id to pass through); `getCurrentActiveModel` can trivially fall back to that default per its own doc comment (interfaces.ts:110-113).

**What visibly degrades with this MVP subset**, per the capability-matrix
precedent (cursor is the closest live example, capabilities.service.ts:90-107):
no MCP servers configurable (empty list in UI, not an error), no skills listed
(empty, not an error), no interactive permission prompts, no token-usage
display, no reasoning-effort control, no Compact/Clear/Fork buttons, no
message editing, and session history is empty until `sessionSynchronizer` is
implemented for real (chat still works turn-by-turn; only the sidebar/history
view is empty). None of this crashes the app — the capability matrix and the
`?`-optional session methods are exactly the mechanism that keeps a partial
provider from breaking other providers or requiring UI changes elsewhere.

### 7. Effort estimate

**Assumptions stated explicitly (this survey did not research the candidate CLI):**
- The candidate CLI has *some* form of scriptable non-interactive invocation and *some* form of on-disk or queryable session history — if it has neither, `runtime` and `sessionSynchronizer` estimates below are void.
- Estimate assumes one engineer already familiar with this repo's provider architecture (i.e., the ramp-up of reading §1-§5 of this document, or the README, is not separately counted).
- Excludes any work on the candidate CLI itself (auth flow discovery, event-format reverse-engineering) beyond what's needed to write against it — that discovery cost is explicitly out of scope per the task brief and is the responsibility of the CLI-research agent.
- Uses opencode's isolated ~2180-line first-cut (§3) as the closest empirical anchor, while noting codex's ~3800-line total (§2) and claude's optional-feature-heavy ~4540-line total (§2) as the range's upper end if fork/rewind/anchors/turn-reuse-equivalents are wanted.

| Component | Engineer-days | Basis |
| --- | --- | --- |
| `runtime` (spawn/stream/normalize/abort, baseline only) | 3-6 | Largest facet with no shared base class (§5); opencode's 757-line runtime, codex's 803-line runtime (560 + 243 RPC client) |
| `sessions` (`normalizeMessage` + `fetchHistory`, no fork/edit/rewind) | 3-6 | 654-2267 lines existing (§2); pagination correctness flagged in README as an error-prone spot (README.md:373) |
| `sessionSynchronizer` (real implementation, not stub) | 1-3 | 158-212 lines for claude/codex/cursor; can balloon if the native format is a shared live DB like opencode's (179 lines + the "don't delete the shared DB" design problem, README.md:210) |
| `mcp` + `skills` (real implementations, using shared base classes) | 0.5-1 | Base classes handle validation/parsing; only format-specific glue needed (§5) |
| `auth` + `models` | 0.5-1 | Small, mostly mechanical (§5) |
| Outside-provider-dir wiring (§4: registry, type unions, UI pickers, icon, i18n for actively-maintained locales, DB schema/migration, commands routing) | 1-2 | ~15-20 files, each a small mechanical diff, but the DB `CHECK` constraint needs an actual migration (§4), not just a text edit |
| Tests (shared-file cases + provider-owned test suite) | 1-2 | Shared-file edits are small; provider-owned tests were 321+73 lines for opencode's sessions/models alone, and a runtime test can be large (opencode's is 873 lines) |
| Docs (ADRs for any capability decisions, fork-customizations entry) | 0.5-1 | Only needed where the new provider's capabilities require a real decision worth recording (§4 docs row) |
| **Baseline total (MVP per §6, no fork/rewind/edit)** | **10-22 engineer-days** | Sum of above |
| Optional: fork + rewind + edit-anchor support | +3-6 | claude's fork/rewind/anchors = 204 lines; opencode's = 241 lines; each is its own design decision recorded as an ADR (§4 docs row lists 4 ADRs just for this) |
| Optional: parity features seen only in claude (turn-reuse, background-work, custom-endpoint routing) | +3-6 | 354 + 117 + 43 = 514 lines in claude alone; not present in codex/cursor/opencode, so treat as "only if the candidate CLI supports the equivalent capability" |

**Range: roughly 10-22 engineer-days for a working MVP provider (chat + basic
session history, matching cursor's current feature floor), 16-34 engineer-days
to reach feature parity with a mid-weight provider like codex or opencode
(fork/rewind included, excluding claude-only extras).** The biggest source of
variance is not in this repo's wiring (§4 is mechanical and bounded) but in
`runtime` and `sessions` (§5, hard-rated) — both scale directly with how far
the candidate CLI's native event/session format is from this repo's
normalized shape, which is exactly the variable this survey was told not to
investigate.
