# Reporting to Upstream

Procedure and template for reporting something back to `siteboon/claudecodeui` (`upstream`) — a bug, a design gap, or a technical finding surfaced while working in this fork. Companion to `docs/upstream-sync.md` (the opposite direction: pulling upstream's changes in). Run this interactively, in the main conversation — see the `upstream-pr` skill's own note on why.

## Before drafting anything

**Search first.** Upstream's own `CONTRIBUTING.md` says this explicitly: *"Search first. Check existing issues and pull requests to avoid duplicating work."* Treat it as mandatory, not a nice-to-have — it has already once saved this fork from re-proposing a fix that upstream had already considered in detail and rejected (`siteboon/claudecodeui#1132`, closed unmerged with a maintainer's one-line "this is intentional"). A title-only search is not enough: if something close comes up, open the actual issue/PR and read the full body and comment thread, not just the title — the real reasoning usually lives in the comments, not the title.

```
gh search issues "<a few different phrasings>" --repo siteboon/claudecodeui --json number,title,state,url
gh search prs "<same phrasings>" --repo siteboon/claudecodeui --json number,title,state,url
gh issue view <n> --repo siteboon/claudecodeui --json body,comments,closedAt
gh pr view <n> --repo siteboon/claudecodeui --json body,comments,mergedAt,closed,commits
```

Try at least 2–3 different phrasings — the exact wording that finds a near-miss is rarely the first one tried.

**Discuss first, for anything that isn't an obvious one-line bug fix.** Also from `CONTRIBUTING.md`: *"Discuss first for new features. Open an issue to discuss your idea before investing time in implementation. We may already have plans or opinions on how it should work."* Upstream explicitly does allow going straight to a PR for plain bug fixes ("Bug fixes are always welcome. If you spot a bug, feel free to open a PR directly.") — but `#1132` was also framed as a plain fix and still got rejected on design grounds, so when there's any real design tradeoff involved (not just an obvious one-line correction), default to filing an issue and proposing a direction rather than writing the code first. Offer to follow up with a PR once a maintainer confirms the direction.

## Draft the entry

Create `docs/pull-requests/` (with a `README.md` index, see below) the first time this is used — it doesn't need to pre-exist. Each entry is its own file, numbered regardless of whether it ends up being an issue or a code PR (GitHub shares one number space between the two): `docs/pull-requests/PR{NN}-{slug}.md`, plus a `.zh-CN.md` twin for the maintainer's own review (the draft title/body inside stays in English either way — see below).

Template:

```markdown
# PR{NN}: {title}

**Status:** Draft — pending review
**Type:** Issue | PR
**Target:** `siteboon/claudecodeui`
**Found:** {date}, {context — e.g. "while syncing this fork to vX.Y.Z"}

## Duplicate check
{Searches run, phrasings tried, what was found (if anything) and why it doesn't cover this.}

## Background
{Why this surfaced now, what it's connected to.}

## Evidence
{Every claim traced to an actual file/line in the current shipped code — not restated from earlier research notes; re-verify against HEAD when drafting, code moves between when something was first noticed and when the draft gets written. Explicitly mark which claims are a direct code trace ("this line does X") versus your own interpretation/inference ("this reads as Y, but is not stated outright") — the maintainer needs to know which is which to decide how hard to push back.}

## Draft title
> {title}

## Draft body
{The literal `gh issue create --body` / `gh pr create --body` content, in English — this is what's actually submitted, so don't translate it even if everything else in this file is in Chinese for the maintainer's review.}

## Submission rationale
- Duplicate-checked (link the search).
- Evidence is code-cited, not speculative.
- Framed as a report/question, not a demand — cite `CONTRIBUTING.md`'s "discuss first" where relevant.
- Relationship to anything else already known (a related retired customization, a prior rejected attempt, etc.)

## Open questions before this ships
1. Title/body OK as-is, or changes wanted?
2. Submit now, or wait for something (e.g. hands-on use of the affected feature)?
3. Which GitHub identity to submit under?
```

Add a row to `docs/pull-requests/README.md`:

```markdown
| # | Title | Type | Status | Link |
|---|---|---|---|---|
| [PR{NN}](PR{NN}-{slug}.md) ([中文](PR{NN}-{slug}.zh-CN.md)) | {title} | Issue/PR | {status} | {GitHub link once submitted, else —} |
```

## If the maintainer pushes back on a claim

Expect it — this is the review working, not a problem. When challenged, don't just re-assert or immediately concede either. Trace the claim further: follow the actual code path end-to-end (e.g. from a UI selection through server-side validation to the exact object/argument passed to the underlying SDK or CLI call), not just to the first plausible-looking spot. Report back precisely what's now confirmed versus what was wrong in the earlier version, and why. A claim that survives this kind of challenge is much stronger evidence for the eventual submission than one that was never tested.

## Before submitting

Get explicit sign-off on the drafted title, body, and rationale — never run `gh issue create` / `gh pr create` without it. Once approved and submitted, update the entry's `Status` (`Submitted`, with the resulting issue/PR link) and never delete the file — keep a record of what went out and, once known, what happened to it (merged, rejected, still open).

If the decision is not to submit (priorities changed, the finding turned out not to matter to this fork, etc.), still keep the file — mark `Status` as `Won't submit — {reason}` rather than deleting it. The verification work is real and reusable even if it's not going out right now.
