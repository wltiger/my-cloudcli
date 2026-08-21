# Reporting to Upstream

Bar, procedure and template for deciding whether to report something back to `siteboon/claudecodeui` (`upstream`) — a bug, a design gap, or a technical finding surfaced while working in this fork. Companion to `docs/upstream-sync.md` (the opposite direction: pulling upstream's changes in). Run this interactively, in the main conversation — see the `upstream-pr` skill's own note on why.

## Is this worth submitting at all?

**Run this before the duplicate check, and before writing any draft.** The bar is deliberately high and the default answer is **no**. Most findings should end as a filed draft marked `Won't submit`, not as a submission.

### The load-bearing test: does *not* submitting cost this fork anything?

Ask it in that direction, not the other way round.

- **A fork customization already neutralises it here.** Upstream owns the problem entirely; this repo is unaffected whether they ever act. → **Default no.**
- **This fork's behaviour is identical to upstream's — no divergence exists.** There is nothing to maintain, nothing to reapply on a sync. → **Default no.**
- **This fork carries a divergence that is painful to reapply every sync, and upstream taking it would retire the entry.** → That is a real cost, and the only thing that reliably clears the bar.

**Severity to upstream's users is explicitly not sufficient.** This has been tested against a hard case: `docs/pull-requests/PR01` established, with measurements from a real device, that no iOS device has ever received a push notification from an unmodified CloudCLI install — a whole platform's feature dead, fixable in one line, with a clean duplicate check. It was still not submitted, because customization #10 already fixes it here. Do not re-litigate that call by arguing severity; if severity alone were enough, PR01 would have gone out.

Reason for the asymmetry: upstream's scarce resource is review attention, not awareness. PRs #995, #1000 and #917 have sat open and unanswered since June–July 2026, one of them proposing the exact fix this fork already carries. Adding to that queue is not free, and it is not obviously helpful.

### If it survives that, check the cost to upstream and the strength of the case

All of these must hold, or drop back to "won't submit":

- **Evidence is measured, not inferred.** Anything you would write as "presumably" or "this reads as" must be run and observed first. This is not theoretical: PR02's central claim — that plain HTTP shows a false success toast — was *wrong*, and only a browser probe against a real non-secure origin caught it. Had it gone out as written, the first thing a maintainer tried would not have matched the report.
- **No untested tuning, no magic numbers.** PR03 proposed `min-w-28` / `max-w-[22rem]` that were this fork's own unjustified values. Either derive them or cut them from the proposal.
- **Not on lines upstream just touched.** PR03 also targeted lines upstream had restyled three days earlier. Proposing changes to freshly-shipped code reads as re-litigating a decision they just made.
- **The fix does not require a design decision from upstream.** If the honest answer is "the effect needs to move somewhere, and where is their call" (PR05), it is triage load rather than an actionable report.

### Recording the verdict

Whatever the answer, write the entry under `docs/pull-requests/` — including the triage that killed it. Set `Status: Won't submit — {reason}` and add a `## Decision ({date})` section giving the reasoning and the conditions under which it should be revisited. Do the cheap triage before the expensive drafting, but once a finding has been investigated at all, the investigation gets kept.

**Never talk the maintainer into submitting.** Present the triage verdict and let them decide. Their standing instruction is "非必要不提" — when in doubt, don't.

## Before drafting anything

Only reach this section if the triage above did **not** kill the finding. A duplicate check is still mandatory before anything is submitted — and if a finding is filed as `Won't submit` without one, the entry and the index row must both say the search was never run, so nobody later mistakes it for submission-ready.

**Search first.** Upstream's own `CONTRIBUTING.md` says this explicitly: *"Search first. Check existing issues and pull requests to avoid duplicating work."* Treat it as mandatory, not a nice-to-have — it has already once saved this fork from re-proposing a fix that upstream had already considered in detail and rejected (`siteboon/claudecodeui#1132`, closed unmerged with a maintainer's one-line "this is intentional"). A title-only search is not enough: if something close comes up, open the actual issue/PR and read the full body and comment thread, not just the title — the real reasoning usually lives in the comments, not the title.

```
gh search issues "<a few different phrasings>" --repo siteboon/claudecodeui --json number,title,state,url
gh search prs "<same phrasings>" --repo siteboon/claudecodeui --json number,title,state,url
gh issue view <n> --repo siteboon/claudecodeui --json body,comments,closedAt
gh pr view <n> --repo siteboon/claudecodeui --json body,comments,mergedAt,closed,commits
```

Try at least 2–3 different phrasings — the exact wording that finds a near-miss is rarely the first one tried.

**Discuss first, for anything that isn't an obvious one-line bug fix.** Also from `CONTRIBUTING.md`: *"Discuss first for new features. Open an issue to discuss your idea before investing time in implementation. We may already have plans or opinions on how it should work."* Upstream explicitly does allow going straight to a PR for plain bug fixes ("Bug fixes are always welcome. If you spot a bug, feel free to open a PR directly.") — but `#1132` was also framed as a plain fix and still got rejected on design grounds, so when there's any real design tradeoff involved (not just an obvious one-line correction), default to filing an issue and proposing a direction rather than writing the code first. Offer to follow up with a PR once a maintainer confirms the direction.

## Write the entry

Every investigated finding gets an entry, whether or not it ships. Scale the effort to the triage verdict: a finding killed by the cost test needs the triage, the evidence that made it real, and the decision — not a polished `Draft body` nobody will send. Only write the submittable title/body once the maintainer has said it's going out.

Create `docs/pull-requests/` (with a `README.md` index, see below) the first time this is used — it doesn't need to pre-exist. Each entry is its own file, numbered regardless of whether it ends up being an issue or a code PR (GitHub shares one number space between the two): `docs/pull-requests/PR{NN}-{slug}.md`, plus a `.zh-CN.md` twin for the maintainer's own review (the draft title/body inside stays in English either way — see below).

Template:

```markdown
# PR{NN}: {title}

**Status:** Won't submit — {reason} | Draft — pending review | Submitted — {link}
**Type:** Issue | PR | — (would have been {Issue|PR})
**Target:** `siteboon/claudecodeui`
**Found:** {date}, {context — e.g. "while syncing this fork to vX.Y.Z"}

## Duplicate check
{Searches run, phrasings tried, what was found (if anything) and why it doesn't cover this.}

## Background
{Why this surfaced now, what it's connected to.}

## Evidence
{Every claim traced to an actual file/line in the current shipped code — not restated from earlier research notes; re-verify against HEAD when drafting, code moves between when something was first noticed and when the draft gets written. Explicitly mark which claims are a direct code trace ("this line does X"), a measurement ("probed X, observed Y"), or your own interpretation/inference ("this reads as Y, but is not stated outright") — the maintainer needs to know which is which to decide how hard to push back.

Anything load-bearing that starts life as an inference must be measured before it is allowed to stay. If the measurement contradicts the inference, correct the entry in place and say so — a visible correction is a feature, it shows the claim was actually tested.}

## Draft title / Draft body
{Only once the maintainer has decided it ships. The literal `gh issue create --body` / `gh pr create --body` content, in English — this is what's actually submitted, so don't translate it even if everything else in this file is in Chinese for the maintainer's review.}

## Submission rationale
{Only for entries that ship.}
- Duplicate-checked (link the search).
- Evidence is code-cited or measured, not speculative.
- Framed as a report/question, not a demand — cite `CONTRIBUTING.md`'s "discuss first" where relevant.
- Relationship to anything else already known (a related retired customization, a prior rejected attempt, etc.)

## Decision ({date})
{Required on every entry. Which way it went and why, in terms of the bar above — especially which limb of the cost test decided it. Then: what would have to change for this to be worth revisiting. If any required step was skipped because the decision came first (e.g. the duplicate check was never run), say so here *and* in the index row, so nobody later mistakes the entry for submission-ready.}
```

Add a row to `docs/pull-requests/README.md`:

```markdown
| # | Title | Type | Status | Link |
|---|---|---|---|---|
| [PR{NN}](PR{NN}-{slug}.md) ([中文](PR{NN}-{slug}.zh-CN.md)) | {title} | Issue/PR | {status, with the one-line reason} | {GitHub link once submitted, else —} |
```

Keep the index's header stating the standing bar, so it's the first thing read next time.

## If the maintainer pushes back on a claim

Expect it — this is the review working, not a problem. When challenged, don't just re-assert or immediately concede either. Trace the claim further: follow the actual code path end-to-end (e.g. from a UI selection through server-side validation to the exact object/argument passed to the underlying SDK or CLI call), not just to the first plausible-looking spot. Report back precisely what's now confirmed versus what was wrong in the earlier version, and why. A claim that survives this kind of challenge is much stronger evidence for the eventual submission than one that was never tested.

## Before submitting

Re-read "Is this worth submitting at all?" one more time. By this point you have sunk effort into the entry, and sunk effort is the main thing that makes a below-bar finding start to look submittable. The triage verdict does not improve because the draft got good.

Get explicit sign-off on the drafted title, body, and rationale — never run `gh issue create` / `gh pr create` without it. Once approved and submitted, update the entry's `Status` (`Submitted`, with the resulting issue/PR link) and never delete the file — keep a record of what went out and, once known, what happened to it (merged, rejected, still open).

If the decision is not to submit — which is the expected outcome for most findings, not a failure — still keep the file. Mark `Status` as `Won't submit — {reason}` and fill in the `## Decision` section rather than deleting anything. The verification work is real and reusable, and it stops the next sync re-deriving the same conclusion from scratch.
