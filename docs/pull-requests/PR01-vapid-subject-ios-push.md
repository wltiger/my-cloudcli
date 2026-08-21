# PR01: VAPID `sub` uses the reserved `.local` TLD, so APNs rejects every iOS push

**Status:** Won't submit — maintainer decided not to spend upstream review attention on it (2026-08-21). Kept for the verification work; the fork carries the fix either way (customization #10).
**Type:** would have been an Issue
**Target:** `siteboon/claudecodeui`
**Found:** 2026-08-21, while syncing this fork to v1.37.2 (the underlying finding predates the sync — see fork customization #10)

## Duplicate check

Searched `siteboon/claudecodeui` issues and PRs (2026-08-21):

- issues/PRs `vapid` → only #858 (`[Refactor] chat adapters`, unrelated) and #450 (the PR that *introduced* the notification system, merged)
- issues/PRs `mailto` → only #450
- issues/PRs `ios notification`, `safari push`, `notification not received`, `web push BadJwtToken`, `notifications iphone` → nothing

Nothing reports this. #450 is where the value was introduced, not where it was questioned. No prior submissions by this account (`wltiger`) exist on the repo.

## Background

Surfaced running this fork as an installed Home Screen web app on iOS. Push notifications were silently never delivered on iPhone while the same server delivered fine to Chrome on Android and Firefox on desktop — no client-side error, no server-side error visible in the UI.

## Evidence

**Direct code trace.** `server/modules/notifications/vapid-keys.service.ts` (upstream/main @ `677b7ba`, lines 28–36):

```js
function configureWebPush() {
  const keys = ensureVapidKeys();
  webPush.setVapidDetails(
    'mailto:noreply@claudecodeui.local',
    keys.publicKey,
    keys.privateKey
  );
  console.log('Web Push notifications configured');
}
```

That string becomes the `sub` claim of the VAPID JWT that `web-push` signs for every outgoing push, for every push service.

**Direct fact.** `.local` is reserved for multicast DNS by [RFC 6762 §3](https://www.rfc-editor.org/rfc/rfc6762#section-3) and is not globally routable, so `noreply@claudecodeui.local` is not a reachable mailbox.

**Empirically verified, not inferred.** Against a live install with a real iOS Home Screen web app subscription — same subscription, same VAPID key pair, only the `sub` value changed between runs:

| `sub` value | APNs response |
|---|---|
| `mailto:noreply@claudecodeui.local` | `403 BadJwtToken` |
| `https://cloudcli.ai` | `201 Created` |
| a routable `mailto:` address | `201 Created` |

**Interpretation (mine, not a code trace).** The reason this went unnoticed is that the other two major push services don't validate the claim: Chrome's FCM and Mozilla's Autopush accept the `.local` subject and deliver normally. Apple documents the requirement in [Sending web push notifications in web apps and browsers](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) ("a `mailto:` or `https:` URL … Apple uses this to contact you"). So the breakage is iOS-only, and iOS is exactly the platform where an installed web app most needs push, since it has no other background channel.

**Scope claim.** Because the subject is a single module-level constant applied to every subscription, this is not a per-device or per-user condition — no iOS device can ever have received a push notification from an unmodified CloudCLI install.

## Draft title

> Web Push: VAPID `sub` is `mailto:…@claudecodeui.local`, which APNs rejects — iOS notifications have never worked

## Draft body

**What happens**

Push notifications are never delivered to iOS devices (Safari / installed Home Screen web app). Android Chrome and desktop Firefox work fine against the same server, so the subscription flow, the keys, and the notification triggers are all fine — only Apple's push service rejects the pushes.

There is no visible symptom: the UI reports the subscription as active, and the failure is a `403` from APNs on the outbound request.

**Root cause**

`server/modules/notifications/vapid-keys.service.ts`:

```js
webPush.setVapidDetails(
  'mailto:noreply@claudecodeui.local',
  keys.publicKey,
  keys.privateKey
);
```

That value becomes the `sub` claim in the VAPID JWT for every push. `.local` is reserved for multicast DNS ([RFC 6762 §3](https://www.rfc-editor.org/rfc/rfc6762#section-3)) and is not routable, so it is not a contactable address.

Apple validates that claim and rejects the request with `403 BadJwtToken`. Apple's docs require a `mailto:` or `https:` URL they can actually use to contact the sender: <https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers>

FCM and Mozilla Autopush do not validate the domain, which is why this only shows up on iOS.

**Verification**

Same live install, same iOS subscription, same key pair — only the subject string changed between runs:

| `sub` | APNs response |
|---|---|
| `mailto:noreply@claudecodeui.local` | `403 BadJwtToken` |
| `https://cloudcli.ai` | `201 Created` |
| a routable `mailto:` address | `201 Created` |

**Suggested fix**

One line — any routable value works, so the choice is yours:

```diff
-    'mailto:noreply@claudecodeui.local',
+    'https://cloudcli.ai',
```

An `https:` URL avoids publishing an address; a real `mailto:` is equally valid. Making it overridable via env (e.g. `VAPID_SUBJECT`) would also let self-hosters point it at their own contact, though the hardcoded default is what actually matters here.

Happy to open a PR if you'd like one — it seemed better to report the finding first given it's a product decision which value you want to ship.

**Environment:** CloudCLI UI v1.37.2 · iOS Home Screen web app · self-hosted over HTTPS

## Submission rationale

- Duplicate-checked across 6 phrasings on both issues and PRs; nothing found.
- Every claim is either a direct code citation, a cited RFC/Apple doc, or an explicitly-labelled empirical measurement against a real device. The one inference (why it went unnoticed) is marked as such.
- Framed as a report with a suggested one-liner, not a demand — the value is upstream's call, which is why this is filed as an issue rather than a PR (`CONTRIBUTING.md`: "Discuss first for new features").
- Related fork state: this is fork customization #10. If upstream ships any routable value, that entry gets retired — the specific string does not matter to this fork.
- Prior-art caution: `siteboon/claudecodeui#1132` was a plain-looking fix rejected on design grounds. This one has no design tradeoff on the *behavior* side (the current value is simply non-functional for one platform); the only choice is which replacement string, which is why the issue defers that to the maintainer.

## Decision (2026-08-21)

**Not submitted.** The maintainer's standing bar for this fork is "don't open an upstream PR unless it's necessary", and under that bar this did not clear it. Upstream's bottleneck is visibly review attention, not awareness — #995, #1000 and #917 have sat open and unanswered since June–July 2026 — so each submission spends a scarce resource.

What tipped it: the impact is real and large (no iOS device has ever received a push from an unmodified install), but it costs this fork nothing — customization #10 already fixes it here, and it would stay fixed whether or not upstream ever acts.

The verification above is kept because it is reusable. Revisit if the calculus changes — e.g. upstream starts responding to PRs again, or this stops being purely upstream's problem and starts costing this fork something on a sync.
