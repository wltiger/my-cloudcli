# CloudCLI UI

CloudCLI UI is a desktop/mobile web UI for driving CLI coding agents (Claude Code, Cursor CLI, Codex, OpenCode). It wraps each agent's own CLI/SDK and session storage rather than duplicating it.

## Language

**Project** (sidebar):
A directory that has ever had at least one CLI agent session in it. Discovered automatically from each provider's on-disk session transcripts on every sidebar refresh — never created manually, and never permanently excluded: new session activity in that directory always reintroduces it.
_Avoid_: Workspace, repo (a project maps 1:1 to a directory, not necessarily a git repo)

**Star** (project):
A per-project flag that only affects sidebar sort order — starred projects sort first. It is not a filter.
_Avoid_: Favorite, pin — reserve "favorite" for the Favorites filter below; don't use it for the raw flag

**Archive** (project):
A soft-hide: removes a project from the main list into the "Archive only" view. Automatically reverses itself the moment any new session activity is detected for that path — it is not a permanent exclusion, and has no relation to Star.
_Avoid_: Delete, hide, remove, exclude

**Favorites filter**:
A client-side view filter, scoped to the Projects tab, that shows only Starred projects. Distinct from Star (which only affects sort order) and Archive (which is a server-side soft-hide with auto-reactivation) — toggling it changes nothing about what's stored, only what's rendered.

**Raw model id**:
The exact model string a provider's own CLI/SDK wrote into a session transcript — read verbatim, with no normalization applied.
_Avoid_: Model name — ambiguous with the friendly display label below

**Prettified label**:
A short, human-readable model label derived from a raw model id when it doesn't exactly match CloudCLI's own hardcoded model catalog. Only produced when the raw id matches a recognizable shape (known family + optional version); an unrecognized id falls back to displaying the raw id unchanged rather than a guessed label.
_Avoid_: Friendly name — reserve that term for the hardcoded catalog's own `label` field (a separate, exact-match code path)

**Tab** (main content):
One of the views the selected Project is worked on through — Chat, Shell, Files, Git, plus Browser and Tasks when available and one per enabled plugin. Scope differs per tab and is easy to get wrong: only Chat and Shell follow the selected session; Files and Git are project-scoped and don't change when the session does.
_Avoid_: Session tab — most tabs ignore the session entirely. Also distinct from the sidebar's Projects/Conversations tabs and the Settings dialog's tabs; when one of those is meant, name it explicitly
