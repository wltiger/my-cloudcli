# PR05: The browser tab title stops updating on the Conversations and Archive sidebar tabs

**Status:** Won't submit — maintainer decided not to spend upstream review attention on it (2026-08-21). Kept because the diagnosis is reusable and this fork inherits the behavior.
**Type:** would have been an Issue
**Target:** `siteboon/claudecodeui`
**Found:** 2026-08-21, during hands-on verification of the v1.37.2 merge — not from reading the diff

## Duplicate check

Not run. The decision not to submit was taken before the duplicate check, so this entry is a diagnosis, not a submission-ready draft. **Anyone reviving this must run the duplicate search first** (`docs/upstream-pr.md`'s "Before drafting anything") — the finding is only three days old upstream, so a duplicate is plausible.

## Background

Found while walking the post-merge verification checklist in a browser: selecting a conversation from the sidebar's **Conversations** feed left the browser tab title showing the *previous* value. Switching the sidebar to **Projects** made it correct itself immediately.

Initially suspected as merge damage. It is not — see below.

## Evidence

**Direct code trace #1 — where the effect lives.** `src/components/sidebar/view/subcomponents/SidebarProjectList.tsx` (upstream/main @ `677b7ba`, lines 97 and 111–113):

```jsx
const pageTitle = getPageTitle(selectedProject, selectedSession);
...
useEffect(() => {
  document.title = pageTitle;
}, [pageTitle]);
```

The only `document.title` writer for project/session naming lives inside `SidebarProjectList`.

**Direct code trace #2 — when that component is mounted.** `src/components/sidebar/view/subcomponents/SidebarContent.tsx` (upstream/main @ `677b7ba`) renders it in exactly two branches of one conditional chain:

- line 429 — `searchMode === 'running'`
- line 689 — the final `else`, i.e. `searchMode === 'projects'`

`searchMode === 'conversations'` (line 384) renders `SidebarRecentConversations` instead, and `searchMode === 'archived'` (line 432) renders the archive list. In both, `SidebarProjectList` is unmounted, its effect is torn down, and nothing writes `document.title` until the user returns to Projects or Running.

**Direct code trace #3 — not caused by this fork's merge.** At the merge base (upstream `v1.37.1`, `9c48092`) the same file already had the same effect in the same component:

```js
useEffect(() => {
  let baseTitle = 'CloudCLI UI';
  const displayName = selectedProject?.displayName?.trim();
  if (displayName) baseTitle = `${displayName} - ${baseTitle}`;
  document.title = baseTitle;
}, [selectedProject]);
```

`SidebarContent`'s conditional structure is byte-identical between upstream's version and this fork's. The fork's only change here was the app-name string (customization #6). Reproducible on a clean upstream v1.37.2 install.

**Observed, 2026-08-21** (Chromium, local dev build of the merge, which is upstream's code on this path):

| Action | `document.title` | Header title |
|---|---|---|
| Conversations tab → click session "Greeting message" | `claudecodeui - CloudCLI` (stale) | `Greeting message` |
| switch sidebar to Projects (no other action) | `Greeting message` | `Greeting message` |
| Projects tab → click session | updates immediately | matches |

**Interpretation (mine).** This is pre-existing placement that v1.37.2 made newly visible rather than a v1.37.2 regression. Before v1.37.2 the effect depended only on `selectedProject`, so a stale title needed the rarer "switch projects while sitting on the Conversations tab". v1.37.2's #1153 added the selected *session* name to the title — and the Conversations feed is the primary UI for switching sessions, so the new feature is inert on the exact surface where it would matter most.

I have not verified the Archive tab hands-on; it is inferred from the same conditional chain.

## What a fix would involve

Not a one-liner, which is part of why it wasn't submitted. The effect needs to move somewhere that stays mounted across sidebar tab changes — a top-level `useDocumentTitle(selectedProject, selectedSession)` hook in `App`/`AppContent`, or the session store. That is a placement decision that belongs to upstream, so this would have been an issue describing the bug, not a PR imposing an answer.

## Decision (2026-08-21)

**Not submitted.** Weighed against the standing "don't open an upstream PR unless it's necessary" bar:

- The symptom is cosmetic — a stale browser tab title. No data loss, no broken action, no workaround needed.
- **It costs this fork nothing.** Unlike entries 10, 12 and 21, there is no divergence being carried here: this fork's behavior is identical to upstream's. Whether upstream fixes it or not changes nothing in this repo.
- Fixing it needs a design decision from upstream about where the effect belongs, so it is more triage load than a one-line bug report.
- It shipped three days before it was found; upstream may well notice it themselves.
- Upstream's scarce resource is review attention (#995, #1000, #917 unanswered since June–July 2026). Spending it here would be poor prioritisation.

Revisit if the stale title ever causes a real problem in daily use, or if this fork ends up wanting its own fix — at which point the fix becomes a fork customization and the "costs us nothing" argument no longer holds.
