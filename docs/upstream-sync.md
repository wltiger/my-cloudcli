# Syncing with Upstream

Step-by-step procedure for pulling `siteboon/claudecodeui` (`upstream`) into this fork (`wltiger/my-cloudcli`, `origin`). Companion to `docs/fork-customizations.md`, which tracks *what* diverges and *why* — this file covers *how* to actually run the sync. For the opposite direction — reporting a bug or gap back to upstream — see the `upstream-pr` skill / `docs/upstream-pr.md` instead; this file only covers pulling upstream's changes in.

Remote/branch setup (`main` mirrors `upstream/main`, `dev` is where all fork work lives) is documented in full in `docs/agents/issue-tracker.md` — this assumes that setup already exists.

## Before starting

- `git status` on `dev` is clean — commit or stash anything in progress first.
- `git config rerere.enabled` is `true` (`git config rerere.enabled true` if not — it auto-replays conflict resolutions this repo has already recorded, so repeated conflicts in the same customized files get easier over time, not harder).

## 0. Check the merge base before anything else

```
git merge-base dev upstream/main
git describe --tags --exact-match <the commit it prints>   # or: git tag --points-at <commit>
```

**The merge base must be a tag you have already synced.** If it is older than the last release in `docs/fork-customizations.md`, the fork's history has lost its merge information: the *content* of the intermediate releases is present on `dev` (a previous sync brought it in), but the ancestry was never recorded — usually because a sync committed its resolved tree as a plain commit instead of a merge, so `upstream/main` never became an ancestor. Every consequence of this is bad and none of it is loud:

- step 1's preview reports conflicts for files that were reconciled releases ago, so the list is *larger* than the work actually is — this repo has seen 224 reported conflicts for what turned out to be 40 real ones;
- the intermediate release's own commits stay "unmerged" forever, so `git log` and `git cherry` both lie about what has landed;
- the next sync re-resolves work that was already done, and can silently revert a customization while doing it.

Fix it with a **record-only merge** before syncing. It rewrites nothing and changes no file — it only teaches git the ancestry that should already have been there:

```
git merge -s ours --no-commit <upstream-commit-for-the-last-synced-tag>
git commit    # message: "Record-only: mark upstream vX.Y.Z as merged"
git diff HEAD^ HEAD --stat    # must be EMPTY — an empty diff is the proof it recorded only ancestry
```

Do this on the working branch (`dev`, or the scratch branch you are about to create), **not** on `main`. Then re-run step 1 and confirm the conflict count dropped to the real number before touching any file. If the preview was already correct, this step is a no-op and costs one command.

A merge commit whose tree differs from its first parent is the signature of doing this wrong — a previous run committed resolved files as a plain commit. `git show --stat <that merge>` should list only files if it was a real merge; a record-only merge lists none.

## 1. Preview the merge (always do this first)

```
git fetch upstream
git merge-tree --write-tree dev upstream/main
```

Read-only — this does not touch the working tree, index, or HEAD (it does write some unreferenced objects to `.git`, which is harmless and gets garbage-collected). It reports the exact files that would conflict if `dev` merged `upstream/main` right now, without guessing from a diffstat. Exit code `1` means there are real conflicts; the output lists each one plus every file that auto-merged cleanly.

Do this **every time**, regardless of how small the sync looks — it's nearly free, and it's what steps 2 and 5 below both depend on.

## 2. Decide: direct on `dev`, or a scratch branch first

Look at the conflict list from step 1.

- **Small sync** — real conflicts in roughly ≤2–3 files, none of them requiring a fork customization to be retired or adapted (just reapplying a customization's existing conflict guidance) → merge directly on `dev` (skip to step 3, using `dev` in place of any scratch branch below).
- **Large sync** — more conflicting files, or resolving any of them means retiring/adapting a customization rather than just reapplying it → work on a scratch branch first (`git checkout -b sync/vX.Y.Z dev`), merge `upstream/main` directly into *that* (not local `main` — leave `main` stale until landing, see step 5), do all resolution and verification there, and only fast-forward `dev` to it once everything is green and reviewed. If it goes wrong, delete the branch — `dev` was never touched.

This is a judgment call, not a hard rule — when in doubt, use the scratch branch; the cost of one extra branch is low next to the cost of leaving `dev` half-resolved.

**Git permissions while on a scratch branch:** commit freely there without asking each time — it's disposable and never touches `dev`/`main`/any remote until you explicitly land it. Landing into `dev`/`main`, and any `git push`, still each need their own confirmation, the same as normal. If the user gives different explicit instructions for a given sync, follow those instead of this default.

For a large sync, consider fanning out parallel research agents by subsystem (e.g. one per unrelated cluster of conflicting files) before resolving anything — each one gets the verified conflict list from step 1 plus the relevant `fork-customizations.md` entries, and reports back a resolution recommendation per file. Cheaper than one agent working through everything serially, and each cluster's context stays focused.

## 3. Update the clean mirror

Skip this step if you're on a scratch branch — `main` stays untouched until step 5.

```
git checkout main
git pull upstream main
```

`main` should fast-forward cleanly — it never carries local commits. If it doesn't fast-forward, something committed to `main` by mistake; fix that first (it shouldn't happen under normal use).

## 4. Merge into the working branch

```
git checkout dev
git merge main
```

(On a scratch branch, this is already done — you merged `upstream/main` directly in step 2.)

Use a real merge, not a rebase — the working branch is already pushed to `origin`, and rebasing would force-push-rewrite shared history every sync for no real benefit here. A merge also leaves an honest record of exactly when each upstream sync landed.

## 5. Resolve conflicts, file by file

For each conflicting file (from step 1's list):

- Check `docs/fork-customizations.md` — is this file listed under one of the numbered customizations?
  - **Yes** → work out which of three outcomes applies, in this order:
    1. **Reapply as-is.** Most entries say "keep mine, reapply the surrounding conditional/wrapper around upstream's new code" — do that.
    2. **Re-evaluate before deciding.** A couple of entries explicitly flag this (currently #5, #6) — read the linked ADR or re-check the reasoning rather than blindly keeping the old resolution.
    3. **Retire or adapt.** If upstream's change looks like it solves the *same underlying problem* the customization exists for, don't default to keeping the customization just because its entry says "keep mine" — that guidance was written before this specific upstream change existed. Check: does upstream's version make the customization fully redundant (retire it — delete the code, mark the entry retired, don't delete the entry itself), partially redundant (adapt — keep only the part that's still uniquely valuable, e.g. a distinct UI entry point, and drop the part upstream now covers), or does the fork's own implementation *replace* rather than *merge with* upstream's data/behavior (if so, keeping it as-is is a regression, not a neutral choice — it'll silently drop whatever upstream added that the fork's version doesn't independently reproduce). Get the user's decision on which of these applies; don't decide unilaterally for anything more than a trivial case.
  - **No** → this is an unexpected conflict on a file not currently tracked as a customization. Resolve it on its own merits, then decide: was this a one-off incidental collision (nothing to record), or does it reveal a real, lasting divergence that belongs in `fork-customizations.md` going forward? Add an entry if the latter.
- `git rerere` will auto-stage identical resolutions it's seen before — review what it did (`git diff --staged`) rather than trusting it blindly, especially if upstream's side of the conflict changed substantially since last time.

**Also check every file that auto-merged cleanly but was touched by both sides** (the rest of step 1's output, outside the `CONFLICT` lines) — a clean merge only means no overlapping line ranges, not that the result is semantically correct. Two known failure shapes to specifically watch for:

- **Duplicate registration.** Both sides add something at the same conceptual slot (a route, an event listener, an export) but at different insertion points in the file, so git sees no overlap. The framework then silently uses only one of them (e.g. Express matching the first of two identically-pathed route handlers) — no error, just quietly wrong behavior. Route tables, registries, and other "list of handlers keyed by name/path" files are the highest-risk shape.
- **Rename that only reached one side.** Upstream renames a shared symbol (a constant, a type); git applies the rename to every line upstream's diff touches, but a fork-added line referencing the old name — sitting outside any conflict hunk — doesn't get touched and silently goes stale. `npm run typecheck` catches this if the old name no longer exists at all; it won't catch a rename to something that still happens to compile (e.g. a still-valid but now-wrong string literal).

## 6. Verify

```
npm install        # in case dependencies changed
npm run typecheck
npm run lint
npm test
```

Then hand off a manual browser smoke-test to the user rather than trying to do a full pass yourself — organize the checklist in three tiers, highest-risk first:

1. **Anything retired or adapted this sync** — the areas most likely to have a real regression, since this is new code, not a reapplied pattern.
2. **Upstream's new features that touch the same subsystem as a customization** — confirm they coexist correctly (no visual/functional collision) even where nothing conflicted.
3. **Upstream's own bug fixes in this release** — lower priority, but worth a spot-check where feasible.

(See `.claude/CLAUDE.md`'s "Local UI testing" section for the fixed test-account setup to hand the user for this.)

## 7. Land and push

**Direct-on-`dev` sync:**
```
git commit          # only if the merge itself needed conflict resolutions to finalize
git push origin dev
```

**Scratch-branch sync**, once verification is green and reviewed:
```
git checkout main && git merge upstream/main   # fast-forward, deferred from step 3
git checkout dev && git merge sync/vX.Y.Z      # fast-forward, since dev never moved
git push origin main
git push origin dev
```
Each push is still its own confirmation, same as any other push.

**`dev` may not fast-forward, and that is fine.** If something landed on `dev` after the scratch branch was cut, `git merge sync/vX.Y.Z` makes a real merge commit instead. Both outcomes are correct — just don't report which one it will be until you have run it (`git merge-base --is-ancestor dev sync/vX.Y.Z` tells you, but only if the command actually succeeds; a failed `git rev-parse --short dev sync/v1.37.4` in Git Bash will answer a different question silently — see `.claude/CLAUDE.md`'s shell-gotchas section).

### Branch bookkeeping: keep only the latest `sync/` branch

**Keep the `sync/vX.Y.Z` branch you just landed. Delete the older ones.** The most recent one is the useful one — it's where you look when a customization's resolution needs re-reading a week later. Anything older is superseded by `dev` and only adds noise to `git branch`.

Before deleting an older `sync/` branch, tag it as a safety net (the tag is cheap and permanent; the branch is not):

```
git tag archive/sync-vX.Y.Z sync/vX.Y.Z
git branch -d sync/vX.Y.Z
```

Confirm it is safe to delete first — the branch should carry nothing `dev` lacks:

```
git diff dev sync/vX.Y.Z --stat    # every line should be a deletion (dev has MORE), no additions
```

A branch that shows *additions* still holds work `dev` never got: stop and look at it rather than deleting. Note that `git branch -d` will also warn "not yet merged to HEAD" for a branch whose work was carried over by copy rather than by merge — that warning is about ancestry, not content, so the tree comparison above is the real check.

`sync/v1.37.3`'s history is the cautionary case here: its four commits were plain commits that copied v1.37.3's content onto `dev`, never a merge, so git reported them "unmerged" forever even though every file was already present. See step 0 for how that happens and how to repair the ancestry.

## After a sync: review `fork-customizations.md`

Some entries exist specifically because upstream *hadn't* solved a problem yet (offline caching, naming inconsistency, etc.). After a sync, skim the list: did upstream ship something that makes any entry fully redundant? If so, remove the customization and delete the entry — don't carry dead divergence forward. If an entry's reasoning changed but the customization is still needed, update its "why"/"on conflict" text rather than leaving it stale.

Then check whether anything the sync surfaced — a bug, a design gap, a validated technical finding — is worth reporting to upstream. If so, use the `upstream-pr` skill (`docs/upstream-pr.md`) rather than drafting a submission from scratch.
