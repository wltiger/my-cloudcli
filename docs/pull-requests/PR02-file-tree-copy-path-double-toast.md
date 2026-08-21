# PR02: File tree "Copy Path" shows success and failure toasts at the same time

**Status:** Won't submit — maintainer decided not to spend upstream review attention on it (2026-08-21). Kept for the verification work; the fork carries the fix either way (customization #12).
**Type:** would have been a PR
**Target:** `siteboon/claudecodeui`
**Found:** 2026-08-21, while syncing this fork to v1.37.2 (finding predates the sync — see fork customization #12)

## Duplicate check

Searched `siteboon/claudecodeui` issues and PRs (2026-08-21):

- PRs `copy path` → #1104 (`feat(editor): add copy button for file path with non-secure context fallback`, **closed unmerged**), #444/#434/#436 (the file-tree feature PRs that introduced this code), #519, #1040
- issues/PRs `clipboard` → #1006 / #1007 (shell paste, unrelated), #767 (terminal paste, unrelated), #490, #1157
- issues/PRs `toast` → nothing about clipboard
- issues `file tree context menu` → nothing

Nothing reports the double toast. #1104 is adjacent but different: it proposed a *new* copy button in the code editor with a non-secure-context fallback, and was closed after the author didn't address review comments — it never touched `useFileTreeOperations.ts`. Notably, v1.37.2 then shipped upstream's own editor copy button, which *does* use the correct shared helper (see Evidence).

## Background

Surfaced while making the file tree context menu reachable on touch devices in this fork; the copy handlers were read closely as part of that work. The touch-reachability change is a fork preference and is not being proposed here — this entry is only the clipboard bug, which is not a preference.

## Evidence

**Direct code trace #1 — the bug.** `src/components/file-tree/hooks/useFileTreeOperations.ts` (upstream/main @ `677b7ba`, lines 242–249):

```js
const handleCopyPath = useCallback((item: FileTreeNode) => {
  navigator.clipboard.writeText(item.path).catch(() => {
    // Clipboard API may fail in some contexts (e.g., non-HTTPS)
    showToast(t('fileTree.toast.copyFailed', 'Failed to copy path'), 'error');
    return;
  });
  showToast(t('fileTree.toast.pathCopied', 'Path copied to clipboard'), 'success');
}, [showToast, t]);
```

`writeText()` returns a promise. The `return` inside `.catch()` returns from the *callback*, not from `handleCopyPath`, so the success toast on the last line always runs — synchronously, before the promise has settled either way. On failure the user gets both toasts.

**Direct code trace #2 — upstream already has the right helper.** `src/utils/clipboard.ts` exports `copyTextToClipboard(text): Promise<boolean>`, which awaits `navigator.clipboard.writeText`, falls back to a hidden-textarea `document.execCommand('copy')` when the async API is unavailable (the non-HTTPS case the comment above worries about), and returns whether it actually succeeded.

**Direct code trace #3 — and uses it, one directory over.** `src/components/code-editor/view/subcomponents/CodeEditorHeader.tsx` (added in v1.37.2) imports `copyTextToClipboard` at line 4 and its own `handleCopyPath` (line 70) is `async`. So the correct pattern is already upstream's own; the file-tree call site was simply not updated.

**Direct code trace #4 — it is also the odd one out in its own file.** Every other operation in `useFileTreeOperations.ts` — rename (line 129), delete (line 164), create (line 215), download (line 273) — is `async`, `await`s the work inside `try`/`catch`, and toasts on the real outcome. `handleCopyPath` is the only handler in the hook that toasts before knowing.

**Direct code trace #5 — call sites.** The file-tree `handleCopyPath` is surfaced as `onCopyPath` and invoked only from `FileContextMenu.tsx` (lines 115 and 165), both as `onSelect: () => onCopyPath?.(item)`. Neither uses the return value, so making the handler `async` is not a breaking change for any caller; only the `handleCopyPath: (item: FileTreeNode) => void` line in the hook's own result type (line 54) needs to become `Promise<void>`.

**Measured, 2026-08-21 — and it corrects an earlier draft of this entry.** An earlier version of this file claimed that over plain HTTP the user "gets only the success toast with nothing copied". That is wrong. Probed in Chromium against a real non-secure origin (`http://192.168.15.110:8099`, `window.isSecureContext === false`), running upstream's exact `handleCopyPath` shape:

| Context | `navigator.clipboard` | What upstream's code actually does |
|---|---|---|
| HTTPS / `localhost` | present | one success toast, path copied — correct |
| clipboard permission denied | present, promise rejects | **both toasts fire** — the double-toast bug |
| plain HTTP on a LAN IP | **`undefined`** | `.writeText` throws `TypeError` on property access **before** the success-toast line, so **no toast appears at all** and the click does nothing |

So the failure mode on a plain-HTTP LAN install is not a lying toast — it is a completely dead menu entry plus an uncaught `TypeError`. `document.execCommand` *is* available in that context (verified in the same probe), so upstream's own `copyTextToClipboard` fallback would make it work.

This reframes the entry: the double toast is the cosmetic half; the substantive half is that Copy Path is silently non-functional for anyone self-hosting over plain HTTP on a LAN — which `.env.example`'s `HOST=0.0.0.0` default makes a normal deployment.

## Draft title

> fix(file-tree): copy path through the shared clipboard helper instead of reporting success unconditionally

## Draft body

**Problem**

Right-clicking a file in the Files tree → **Copy Path** always shows "Path copied to clipboard", even when the copy failed. When it fails, both toasts appear — "Failed to copy path" *and* "Path copied to clipboard" — which is worse than either alone.

`src/components/file-tree/hooks/useFileTreeOperations.ts`:

```js
const handleCopyPath = useCallback((item: FileTreeNode) => {
  navigator.clipboard.writeText(item.path).catch(() => {
    showToast(t('fileTree.toast.copyFailed', 'Failed to copy path'), 'error');
    return;
  });
  showToast(t('fileTree.toast.pathCopied', 'Path copied to clipboard'), 'success');
}, [showToast, t]);
```

`writeText()` is async. The `return` exits the `.catch` callback, not `handleCopyPath`, so the success toast fires synchronously before the promise settles — on every call, regardless of outcome.

There's a worse half. Over plain HTTP on a LAN IP (a normal self-hosted setup — `.env.example` defaults to `HOST=0.0.0.0`) the page is not a secure context, so `navigator.clipboard` is `undefined`. `.writeText` then throws a `TypeError` on property access, *before* the success-toast line — so no toast appears at all, nothing is copied, and an uncaught `TypeError` lands in the console. Copy Path is simply dead there.

**Fix**

The repo already has the helper for this — `copyTextToClipboard()` in `src/utils/clipboard.ts` awaits the async API, falls back to `document.execCommand('copy')` when it isn't available, and returns whether the copy actually happened. `CodeEditorHeader.tsx` uses it already. This just routes the file-tree handler through the same helper and toasts on the real result:

```js
const handleCopyPath = useCallback(async (item: FileTreeNode) => {
  const copied = await copyTextToClipboard(item.path);
  showToast(
    copied
      ? t('fileTree.toast.pathCopied', 'Path copied to clipboard')
      : t('fileTree.toast.copyFailed', 'Failed to copy path'),
    copied ? 'success' : 'error',
  );
}, [showToast, t]);
```

No new strings, no new dependencies. `handleCopyPath` becomes `async`, so the hook's result type changes from `(item: FileTreeNode) => void` to `(item: FileTreeNode) => Promise<void>`; both call sites (`FileContextMenu.tsx` lines 115 and 165) invoke it as a fire-and-forget `onSelect` and ignore the return value, so nothing else changes.

This also makes the handler consistent with every other operation in the same hook — rename, delete, create and download are all already `async` + `await` + toast-on-real-outcome. `handleCopyPath` is the only one that isn't.

**Testing**

- HTTPS / localhost: one success toast, path is on the clipboard (unchanged behavior).
- Plain HTTP on a LAN IP (`isSecureContext === false`): previously no toast at all, nothing copied, uncaught `TypeError`; now the `execCommand` fallback copies and one success toast shows.
- Clipboard denied by permission policy: previously both toasts; now one error toast.

## Submission rationale

- Duplicate-checked across 4 phrasings on both issues and PRs. The one near-miss (#1104) is a different file, a different feature, and closed unmerged for unrelated reasons.
- Every claim is a direct code citation against `677b7ba` or a browser measurement recorded in Evidence. The plain-HTTP behavior was originally written as inference, then measured — and the measurement contradicted the inference, so the entry was corrected before any submission was considered.
- This is the kind of change `CONTRIBUTING.md` says to send directly ("Bug fixes are always welcome … feel free to open a PR directly"): no new behavior, no design tradeoff, and it moves the call site onto upstream's own existing helper rather than introducing a fork opinion.
- Related fork state: this is one half of fork customization #12. The *other* half of #12 (touch-reachable menu entry points, "Copy Relative Path") is a fork preference and is deliberately **not** part of this PR — proposing them together would turn a clean bug fix into a feature discussion.

## Decision (2026-08-21)

**Not submitted.** The maintainer's standing bar for this fork is "don't open an upstream PR unless it's necessary", and under that bar this did not clear it. Upstream's bottleneck is visibly review attention, not awareness — #995, #1000 and #917 have sat open and unanswered since June–July 2026 — so each submission spends a scarce resource.

What tipped it: the substantive half only bites plain-HTTP LAN installs, and the fork already routes this through the shared helper. On HTTPS and localhost — how most people run it — upstream's code behaves correctly.

The verification above is kept because it is reusable. Revisit if the calculus changes — e.g. upstream starts responding to PRs again, or this stops being purely upstream's problem and starts costing this fork something on a sync.
