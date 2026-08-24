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

**Reading text** (chat):
The text in a chat message a person actually reads word by word to follow the conversation: the message bodies themselves, and the questions, options and option explanations an agent puts to the user. Everything else in the message stream is _chrome_ — timestamps, token counts, status badges, button labels, keyboard hints, tool card summary lines — glanced at rather than read, and sized for density instead of legibility. Code, diffs and command output are their own category again: read closely, but sized as code rather than as prose. The distinction exists because only reading text follows the reader's chosen font size.
_Avoid_: Content, body text — both get read as "everything that isn't a control", which wrongly pulls in tool card summaries and command output

**Raw model id**:
The exact model string a provider's own CLI/SDK wrote into a session transcript — read verbatim, with no normalization applied.
_Avoid_: Model name — ambiguous with the friendly display label below

**Prettified label**:
A short, human-readable model label derived from a raw model id when it doesn't exactly match CloudCLI's own hardcoded model catalog. Only produced when the raw id matches a recognizable shape (known family + optional version); an unrecognized id falls back to displaying the raw id unchanged rather than a guessed label.
_Avoid_: Friendly name — reserve that term for the hardcoded catalog's own `label` field (a separate, exact-match code path)

**Tab** (main content):
One of the views the selected Project is worked on through — Chat, Shell, Files, Git, plus Browser and Tasks when available and one per enabled plugin. Scope differs per tab and is easy to get wrong: only Chat and Shell follow the selected session; Files and Git are project-scoped and don't change when the session does.
_Avoid_: Session tab — most tabs ignore the session entirely. Also distinct from the sidebar's Projects/Conversations tabs and the Settings dialog's tabs; when one of those is meant, name it explicitly
**Compact** (session):
Replacing the earlier part of a session's conversation with a model-written summary, so the session continues under the same session id with far fewer context tokens. Provider-native and one-way with respect to Rewind: the summarized messages stay in the on-disk transcript, but they stop being addressable, so a Rewind target from before a Compact no longer resolves.
_Avoid_: Summarize, condense — summarizing is the mechanism, not the operation. Also distinct from Clear, which starts a different session rather than shrinking this one.

**Clear** (session):
Retiring the open conversation and continuing in an empty one. The retired session is left whole and Archived rather than emptied, and a new session takes over — so it is a session boundary, not a context operation, and nothing it contained becomes unreadable.
_Avoid_: Reset, wipe. Don't describe it as "clearing the current session": the current session is left untouched and a different one takes over.

**Rewind** (session):
Re-sending an earlier message so the session continues from that point, keeping the same session id and the same transcript file. Everything that followed the chosen message leaves the context without being deleted. A Rewind is inseparable from the message that triggers it — there is no state in which a session is rewound and waiting for input. Whether it also restores tracked files to their state at that point is settled by the provider, not chosen per Rewind.
_Avoid_: Undo, revert — both read as "put the files back". Also distinct from Clear, which cannot preserve the session id.

**Fork** (session):
Copying a session's transcript up to a chosen message into a **new** session with its own id, leaving the original untouched and still resumable. The branching counterpart to Rewind: the same choose-a-message gesture, the opposite outcome for the session id.
_Avoid_: Branch, duplicate, copy — reserve those for git. Also distinct from Rewind, which continues the same session instead of creating one.

**Transcript row**:
One line of a provider's own on-disk session record. Not the unit a reader sees: a single agent turn is written as several rows — reasoning, text, one per tool call — which CloudCLI renders as one message plus its tool cards. Only rows carry an identity the provider will accept back; the ids on rendered messages are CloudCLI's own.
_Avoid_: Line, entry, event

**Anchor**:
The transcript row a Rewind or Fork is taken at, named the way its provider names it. Chosen by pointing at a message but never derivable from one: providers disagree about which row the same gesture lands on, and even about whether the named row is kept or dropped — OpenCode's own fork excludes it while its own revert includes it. A message with no anchor is one the operation cannot be performed on at all.
_Avoid_: Checkpoint, cut point, target
