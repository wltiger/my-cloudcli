# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CloudCLI UI (npm package `@cloudcli-ai/cloudcli`, formerly "Claude Code UI") is a desktop/mobile web UI for driving CLI coding agents — Claude Code, Cursor CLI, Codex, and OpenCode — from a browser. It wraps each agent's own CLI/SDK and session storage (`~/.claude`, `~/.codex`, `~/.cursor`, etc.) rather than duplicating it; changes made in the UI (MCP servers, permissions) are read/written directly to the agent's native config.

Frontend: React 18 + Vite + Tailwind, with an optional Electron desktop shell.
Backend: Express + `ws` (WebSocket) on Node 22+, mixed JS/TS mid-migration to TypeScript.

## Commands

```bash
npm run dev                # frontend (Vite :5173) + backend (:3001) concurrently
npm run server:dev         # backend only (tsx, no watch)
npm run server:dev-watch   # backend only, restarts on change
npm run client             # frontend only

npm run build               # build:client + build:server
npm run typecheck           # tsc --noEmit for both src/ and server/
npm run lint / lint:fix     # eslint src/ server/
npm test                    # backend: node's test runner via tsx, globs server/**/*.test.{ts,js}
npm run test:client         # frontend: same runner, globs src/**/*.test.{ts,tsx}

# run a single backend test file:
npx tsx --tsconfig server/tsconfig.json --test server/modules/git/tests/git.test.ts

npm run desktop:dev         # Electron shell against a running local dev server
```

`npm test` and `npm run test:client` are separate suites — running only `npm test` skips every frontend test. Legacy `src/**/*.test.js` files (e.g. `src/utils/api.test.js`) match neither glob and are plain assertion scripts nothing runs.

`test:client` runs under a plain `tsx` runner with no Vite, so a module that reads `import.meta.env` at module scope cannot be imported from a test at all — and neither can anything importing it, which is most of `src/`. Guard such reads with `?.` (see `src/shared/utils.ts`); Vite still replaces them statically.

`postinstall` runs `scripts/fix-node-pty.js` (native module patch). `prepare` installs husky hooks; pre-commit runs `lint-staged` (eslint on staged `src/**` and `server/**` files), commit-msg enforces Conventional Commits via commitlint.

## Local UI testing (dev server / browser automation)

The default auth DB lives at `~/.cloudcli/auth.db` and is shared with any other CloudCLI install (official npm package, other clones) on this machine — it holds the real user account and session data. **Never test against it.**

When starting the dev server to manually verify a UI change (e.g. via Playwright), point `DATABASE_PATH` at a **fixed, reused** project-local file — do not create a fresh throwaway DB per test run, and do not re-register an account each time. Re-registering + re-clicking through onboarding every run wastes effort for no benefit; the DB persists the account and onboarding-completion state across runs, so registration only has to happen once, ever.

```
DATABASE_PATH=.local/test-auth.db
```

`*.db` is already gitignored repo-wide, so no extra `.gitignore` entry is needed.

**First time only** (the DB file doesn't exist yet): start the server against it and register a fixed test account through the normal sign-up screen — e.g. username `testuser` / password `testpass123` (self-hosted mode allows exactly one account per DB, so pick credentials once and reuse them in every future run). The post-registration onboarding wizard's first step (Git Configuration) can get stuck when driven via automation (`Next` doesn't advance even with valid fields) — skip it by calling the completion endpoint directly with the account's JWT:

```bash
curl -X POST http://localhost:3001/api/user/complete-onboarding -H "Authorization: Bearer <token>"
```

**Every run after that**: the DB already has the account and completed onboarding — don't touch the login screen at all. Get a fresh JWT with one request, then seed it into the browser's `localStorage` (key `auth-token`, see `src/utils/api.js`) before the app's first render, so it loads already authenticated:

```bash
curl -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"username":"testuser","password":"testpass123"}'
# -> { "token": "..." }
```

In Playwright, set this before navigating (e.g. via `context.addInitScript` bound to the app's origin, or navigate once, `page.evaluate` to set `localStorage.setItem('auth-token', token)`, then reload) — the project list loads directly, no sign-in form, no onboarding wizard, every time.

Remember to stop the dev server and kill any leftover process on ports 3001/5173 afterward (`concurrently`'s SIGTERM doesn't always reach the child `tsx`/`vite` processes on Windows — check `netstat -ano | grep :3001` if a restart fails with `EADDRINUSE`).

**Running multiple test/build agents concurrently:** give each its own `DATABASE_PATH`/`SERVER_PORT`/`VITE_PORT` so their dev servers don't collide — but that alone isn't enough. The MCP Playwright server shares one underlying browser/session across all callers in this environment, so concurrent agents driving it can land on each other's tabs mid-`evaluate` (observed: one agent's `localStorage` write/delete landing on a sibling's page). Each concurrently-running agent that needs real browser verification must launch its **own isolated browser instance** instead of relying on the shared MCP Playwright tools — e.g. drive `playwright-core` (or `playwright`) directly against the system's installed Chromium/Edge from a throwaway script, rather than the shared server. Sequential (one-at-a-time) testing can keep using the shared MCP tools as normal; this only matters when multiple agents are testing in parallel.

## Backend architecture (`server/`)

Backend code follows a strict feature-module layout enforced by ESLint (`eslint-plugin-boundaries`, see `eslint.config.js`) — violations are lint **errors**, not style nits. Full rules: `.agents/skills/backend-module-standards/SKILL.md` (auto-loaded per `AGENTS.md` for any `server/` work).

- Each feature lives in `server/modules/<feature>/` (e.g. `auth`, `git`, `providers`, `websocket`, `database`, `plugins`, `taskmaster`, `worktrees`, `browser-use`). New backend module files must be TypeScript.
- Every module has an `index.ts` **barrel** exposing only its public API. Cross-module imports MUST go through that barrel — deep-importing another module's routes/services/internals is a lint error.
- Shared backend code lives only in `server/shared/{types.ts,interfaces.ts,utils.ts}` plus a few named files (`frontmatter.ts`, `claude-cli-path.ts`, `image-attachments.ts`). No module-local `types.ts`/`interfaces.ts`/`utils.ts`. Modules may only `import type` from `server/shared/types.ts` / `interfaces.ts` (runtime imports of those files are blocked).
- Routes stay thin: parse/validate input, call service(s), format the response. Business logic, filesystem, and subprocess work belongs in services.
- Tests live in `server/modules/<feature>/tests/`.
- Backend path alias: `@/*` → `server/*` (see `server/tsconfig.json`). Frontend alias: `@/*` → `src/*` (see `tsconfig.json` / `vite.config.js`) — the two `@` aliases are intentionally independent per side.
- `server/index.ts` is the composition root: builds the Express app, wires one shared WebSocket server (chat/shell/plugin-proxy) via `createWebSocketServer`, mounts every module's routes under `/api/<module>`, and starts the DB + session watcher + plugin processes on boot.

### Providers module (multi-agent abstraction)

`server/modules/providers/` is the adapter layer over the four supported CLI agents (`claude`, `codex`, `cursor`, `opencode`). Each provider under `list/<provider>/` implements 7 facets — `runtime`, `models`, `auth`, `mcp`, `skills`, `sessions`, `sessionSynchronizer` — matching interfaces in `server/shared/interfaces.ts`, registered in `provider.registry.ts`.

**Read `server/modules/providers/README.md` before adding a provider or touching provider wiring** — it documents the full facet contract, file layout, per-provider MCP/skill/session-sync formats, a wrapper template, and the exact list of files to update in both `server/` and `src/` (it's kept current on purpose; don't duplicate its content here).

### Database

`server/modules/database/` wraps a `better-sqlite3` auth/sessions DB (`connection.ts`, `schema.ts`, `migrations.ts`, `init-db.ts`, `repositories/`). Path configurable via `DATABASE_PATH` env var; auto-migrates on `initializeDatabase()` at server startup.

## Frontend architecture (`src/`)

- `components/<feature>/` — feature-scoped UI (chat, git-panel, file-tree, shell, mcp, plugins, task-master, provider-auth, …); many contain their own `hooks/`/`view/` sub-structure.
- `contexts/` — React context providers (Auth, Theme, WebSocket, Permission, Plugins, TaskMasterSettings…).
- `stores/` — non-context app state (e.g. `useSessionStore.ts`, message reconciliation logic).
- `utils/api.js` — the HTTP client wrapper for all `/api/*` calls.
- `i18n/` — i18next setup; `locales/` holds per-language translation files (README/READMEs are translated into several languages too — keep `docs/README.md` as the source of truth and mirror significant changes to `docs/README.*.md` only if asked).
- `lib/`, `hooks/`, `types/` — shared frontend utilities, custom hooks, and TS type defs (`src/types/app.ts` holds the frontend `LLMProvider` union, kept in sync with the backend one).

Vite dev server proxies `/api`, `/ws`, `/shell`, `/plugin-ws` to the Express backend (see `vite.config.js`); in production the Express server serves the built `dist/` directly (see `server/index.ts`).

## Plugin system

`plugins/` holds installable plugins (each can add a frontend tab, optional Node backend service, and RPC over `/plugin-ws`). Plugin lifecycle (install/enable/start/stop) is managed by `server/modules/plugins/`. See `plugins/starter/` for the reference shape; the public plugin API is documented at cloudcli.ai/docs/plugin-overview (referenced from `docs/README.md`).

## Electron desktop shell

`electron/` is an optional native wrapper (macOS/Windows) that can open CloudCLI Cloud or a locally-running/self-started CloudCLI server (`electron/localServer.js`, `electron/serverInstaller.js`). It is packaged separately from the main npm publish via `desktop:*` scripts and `electron-builder` config in `package.json`.

## Conventions

- Commit messages follow Conventional Commits (`type(scope): description`, imperative present tense) — enforced by commitlint on commit.
- Import order is enforced by `eslint-plugin-import-x` (`builtin → external → internal → parent → sibling → index`, blank line between groups) on both `src/` and `server/`.
- All Claude Code tools are disabled by default in the UI itself (a safety default for end users of the app, not for development in this repo) — enabled per-tool from Settings.

## Agent skills

### Issue tracker

GitHub issues on your fork (`wltiger/my-cloudcli`), not upstream (`siteboon/claudecodeui`). See `docs/agents/issue-tracker.md`.

### Syncing with upstream

Whenever asked to sync/merge/pull in the latest official source (`upstream/main`), or to check whether an upstream change affects one of this fork's own customizations, follow `docs/upstream-sync.md` (the step-by-step procedure) and `docs/fork-customizations.md` (the inventory of what diverges from upstream and why, with per-item merge-conflict guidance) — do not improvise the merge from scratch. Chinese translations: `docs/upstream-sync.zh-CN.md`, `docs/fork-customizations.zh-CN.md`.

**Keep `docs/fork-customizations.md` (+ its `.zh-CN.md` twin) current going forward.** Whenever a piece of work adds, extends, or removes a fork-specific customization (an opt-in setting, a behavior that deviates from upstream, anything that could conflict with a future upstream merge) — not routine bug fixes or upstream-aligned work — add or update its numbered entry as part of that same task, not as a separate followup. Merge multiple iterations of the same feature into one entry rather than appending a new one each time (see `docs/fork-customizations.md`'s own note on the chat-spacing entry for the pattern). Skip entries for things that don't actually diverge from upstream's own direction.

**Verify every fork-owned / upstream-owned label with `git cat-file -e upstream/main:<path>`** — success means upstream owns the file, failure means this fork created it. Never infer ownership from a file's name or the directory it sits in; a test named after an upstream module, or a fork's file placed beside upstream ones, reads the wrong way round. A mislabelled entry passes lint and tests silently and only surfaces during the next merge, pointing it at the wrong resolution.

### Reporting to upstream

**The bar is high and the default is not to submit.** When a bug, design gap, or validated finding surfaces that looks reportable to upstream (`siteboon/claudecodeui`) — including at the end of an upstream sync — follow `docs/upstream-pr.md` rather than improvising. Run its "Is this worth submitting at all?" triage *first*, before any duplicate check or drafting: the load-bearing question is whether *not* submitting costs this fork anything, and severity to upstream's users is explicitly not sufficient on its own. Findings that don't clear the bar still get written up under `docs/pull-requests/` with `Status: Won't submit — {reason}` — that's the expected outcome, not a failure. Chinese translation: `docs/upstream-pr.zh-CN.md`. Run this interactively; never submit via `gh` without the maintainer's explicit sign-off, and never argue them into submitting.

### Triage labels

Default 5-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), unmodified. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (root `CONTEXT.md` + `docs/adr/`, created lazily as needed). See `docs/agents/domain.md`.
