# PR03: Wide markdown tables compress instead of scrolling

**Status:** Draft — pending review
**Type:** PR
**Target:** `siteboon/claudecodeui`
**Found:** 2026-08-21, while syncing this fork to v1.37.2 — v1.37.2's table restyle collided with this fork's existing fix, which is what surfaced it

## Duplicate check

Searched `siteboon/claudecodeui` issues and PRs (2026-08-21):

- issues/PRs `markdown table scroll`, `wide table`, `table overflow`, `table columns squeezed` → nothing
- issues/PRs `table` → only unrelated hits (#1131 model catalog "hardcoded table", #1026 markdown file preview, #1132 model catalog, #1161 configurable ignored dirs)
- issues/PRs `markdown rendering` → #215 (merged — the PR that *added* table support), #278, #939, #1037
- issues/PRs `horizontal scroll` / `min-w-full` → #796 / #859, both about the **code editor** toolbar being pushed off-viewport by long unwrapped lines, not markdown tables

Nothing reports this. #215 (`Add markdown improvements: inline code normalization, table support, and copy button for code blocks`) is where tables came from; its description is three bullets — "add remark-gfm to render table" — with no discussion of overflow behavior, so the current CSS reads as an oversight rather than a deliberate choice. v1.37.2's #1153 restyled these exact lines (rounded bordered wrapper, borderless cells) without changing the sizing behavior.

## Background

This fork has carried a local fix for this since before v1.37.2. The v1.37.2 sync produced a conflict on exactly these lines, which is what prompted checking whether upstream had ever been told.

## Evidence

**Direct code trace.** `src/components/chat/view/subcomponents/Markdown.tsx` (upstream/main @ `677b7ba`, lines 199–214):

```jsx
table: ({ children }) => (
  <div className="my-3 overflow-x-auto rounded-lg border border-border">
    <table className="my-0 min-w-full border-collapse text-sm">{children}</table>
  </div>
),
thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
th: ({ children }) => (
  <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">{children}</th>
),
td: ({ children }) => (
  <td className="border-b border-border/60 px-3 py-2 align-top">{children}</td>
),
```

The wrapper has `overflow-x-auto`; the table has `min-w-full` (i.e. `min-width: 100%`) and no maximum, and the cells have no width constraints at all.

**Mechanism (CSS spec behavior, not measured on a device).** With the default `table-layout: auto`, a table's used width is `max(min-content, min(max-content, available))`. For a table of ordinary prose, each column's min-content width is roughly its longest single word — so a 6- or 8-column table of sentences still has a min-content width that fits the chat column, and the browser resolves it by wrapping text down to very narrow columns rather than exceeding the container. Because the table never exceeds the wrapper, `overflow-x-auto` has nothing to scroll.

This is why the symptom looks intermittent: a table whose cells contain long unbreakable tokens (URLs, hashes, file paths) *does* push past min-content, does overflow, and does scroll correctly today. A table of prose does not.

**What the fork changed** (three classes, no structural change):

- `w-max` on the `<table>`, alongside `min-w-full` — the table takes its max-content width, so it can exceed the wrapper and there is something to scroll. `min-w-full` still keeps a narrow table filling the column.
- `min-w-28` / `max-w-[22rem]` on `th`/`td` — floors a column so it cannot collapse to one character, and caps it so a single verbose cell cannot stretch the table arbitrarily wide.
- `overscroll-x-contain` on the wrapper — a horizontal swipe that reaches the end of the table stops there instead of chaining to the page/history behind it. This matters on touch, where the gesture is otherwise easy to trigger by accident.

I have exercised this in the fork's own chat view; I have not benchmarked it against every locale or CJK text, where min-content behaves differently (per-character breaking), so the caps may want different values there — flagged in the open questions below.

## Draft title

> fix(chat): let wide markdown tables scroll instead of compressing their columns

## Draft body

**Problem**

A markdown table with more than a few columns of prose becomes unreadable in the chat view: instead of the container scrolling horizontally, every column is compressed until the text wraps down to one or two characters per line.

`src/components/chat/view/subcomponents/Markdown.tsx`:

```jsx
<div className="my-3 overflow-x-auto rounded-lg border border-border">
  <table className="my-0 min-w-full border-collapse text-sm">{children}</table>
</div>
```

The wrapper is set up to scroll, but the table can never trigger it. With `table-layout: auto` the used width is `max(min-content, min(max-content, available))`, and for text content the min-content width (roughly the longest word per column) usually still fits the chat column — so the browser wraps the text down rather than overflowing. Nothing ever exceeds the wrapper, so `overflow-x-auto` never engages.

It looks intermittent because tables containing long unbreakable tokens (URLs, hashes, paths) *do* exceed min-content and *do* scroll correctly today. Tables of sentences don't.

**Fix**

Three utility classes, no structural change to the renderer:

```diff
 table: ({ children }) => (
-  <div className="my-3 overflow-x-auto rounded-lg border border-border">
-    <table className="my-0 min-w-full border-collapse text-sm">{children}</table>
+  <div className="my-3 overflow-x-auto overscroll-x-contain rounded-lg border border-border">
+    <table className="my-0 w-max min-w-full border-collapse text-sm">{children}</table>
   </div>
 ),
 th: ({ children }) => (
-  <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">{children}</th>
+  <th className="min-w-28 max-w-[22rem] border-b border-border px-3 py-2 text-left font-semibold text-foreground">{children}</th>
 ),
 td: ({ children }) => (
-  <td className="border-b border-border/60 px-3 py-2 align-top">{children}</td>
+  <td className="min-w-28 max-w-[22rem] border-b border-border/60 px-3 py-2 align-top">{children}</td>
 ),
```

- `w-max` (kept alongside `min-w-full`) lets the table take its natural width so the wrapper has something to scroll; `min-w-full` still makes a narrow table fill the column.
- `min-w-28` / `max-w-[22rem]` floor a column so it can't collapse to a single character, and cap it so one verbose cell can't stretch the table arbitrarily.
- `overscroll-x-contain` stops a horizontal swipe inside the table from chaining out to the page behind it — mostly a touch-device concern.

The v1.37.2 restyle (rounded wrapper, borderless cells, `my-0`) is untouched; this only changes sizing.

**Testing**

- 8-column table of sentences: previously each column wrapped down to ~1–2 characters; now the table scrolls horizontally inside the bordered wrapper.
- 2-column table: unchanged — `min-w-full` still fills the chat column.
- Table of long URLs: unchanged — already scrolled before.
- Narrow viewport (phone width): scrolls, and the swipe no longer chains to browser back/forward.

## Submission rationale

- Duplicate-checked across 7 phrasings on both issues and PRs; the two near-misses (#796/#859) are the code editor, not markdown.
- The failure mechanism is stated as CSS spec behavior and explicitly labelled as such rather than as a measurement; the code citations are exact against `677b7ba`.
- `CONTRIBUTING.md` invites direct PRs for bug fixes. This is CSS-only, additive, and preserves v1.37.2's fresh restyle rather than reverting any of it — so it shouldn't read as re-litigating a design decision the maintainer just made.
- Related fork state: this is fork customization #21. If upstream takes it, that entry gets retired.

## Open questions before this ships

1. Title/body OK as-is, or changes wanted?
2. The `22rem` cap and `28` (7rem) floor are this fork's tuning, not derived from anything. Propose them as-is, or drop the cap/floor and submit only `w-max` + `overscroll-x-contain` — a smaller, harder-to-argue-with change that leaves the column-width tuning to upstream?
3. CJK text breaks per-character, so min-content is much narrower and the compression is *worse*, but the `22rem` cap may also be wrong for it. Worth mentioning, or out of scope?
4. Submit under `wltiger`, or another identity?
