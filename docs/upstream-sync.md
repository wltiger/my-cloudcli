# Syncing with Upstream

Step-by-step procedure for pulling `siteboon/claudecodeui` (`upstream`) into this fork (`wltiger/my-cloudcli`, `origin`). Companion to `docs/fork-customizations.md`, which tracks *what* diverges and *why* — this file covers *how* to actually run the sync.

Remote/branch setup (`main` mirrors `upstream/main`, `dev` is where all fork work lives) is documented in full in `docs/agents/issue-tracker.md` — this assumes that setup already exists.

## Before starting

- `git status` on `dev` is clean — commit or stash anything in progress first.
- `git config rerere.enabled` is `true` (`git config rerere.enabled true` if not — it auto-replays conflict resolutions this repo has already recorded, so repeated conflicts in the same customized files get easier over time, not harder).

## Procedure

1. **Update the clean mirror.**
   ```
   git checkout main
   git pull upstream main
   ```
   `main` should fast-forward cleanly — it never carries local commits. If it doesn't fast-forward, something committed to `main` by mistake; fix that first (it shouldn't happen under normal use).

2. **Merge into the working branch.**
   ```
   git checkout dev
   git merge main
   ```
   Use a real merge, not a rebase — `dev` is already pushed to `origin`, and rebasing would force-push-rewrite shared history every sync for no real benefit here. A merge also leaves an honest record of exactly when each upstream sync landed.

3. **Resolve conflicts, file by file.** For each conflicting file:
   - Check `docs/fork-customizations.md` — is this file listed under one of the numbered customizations?
     - **Yes** → follow that entry's "On upstream conflict" guidance. Most entries say "keep mine, reapply the surrounding conditional/wrapper around upstream's new code." A couple (currently #5, #6) explicitly say to re-evaluate rather than blindly keep — read the linked ADR or re-check the reasoning before resolving those.
     - **No** → this is an unexpected conflict on a file not currently tracked as a customization. Resolve it on its own merits, then decide: was this a one-off incidental collision (nothing to record), or does it reveal a real, lasting divergence that belongs in `fork-customizations.md` going forward? Add an entry if the latter.
   - `git rerere` will auto-stage identical resolutions it's seen before — review what it did (`git diff --staged`) rather than trusting it blindly, especially if upstream's side of the conflict changed substantially since last time.

4. **Verify.**
   ```
   npm install        # in case dependencies changed
   npm run typecheck
   npm run lint
   npm test
   ```
   Then manually smoke-test in a browser (see `.claude/CLAUDE.md`'s "Local UI testing" section for the fixed test-account setup) — at minimum, re-check the areas listed in `docs/fork-customizations.md`, since those are exactly the places a silent behavioral regression from a bad merge resolution would show up.

5. **Commit and push.**
   ```
   git commit          # only if the merge itself needed conflict resolutions to finalize
   git push origin dev
   ```

## After a sync: review `fork-customizations.md`

Some entries exist specifically because upstream *hadn't* solved a problem yet (offline caching, naming inconsistency, etc.). After a sync, skim the list: did upstream ship something that makes any entry fully redundant? If so, remove the customization and delete the entry — don't carry dead divergence forward. If an entry's reasoning changed but the customization is still needed, update its "why"/"on conflict" text rather than leaving it stale.
