# #74 — Export: styled standalone HTML

**Status:** Approved for implementation
**Parent:** #26 — H0 — Markdown Import/Export (full round-trip)
**Blocked by:** #60 — OI-T1 Callout node (landed in `de5483e`; this ticket adds the
general stylesheet the callout work deliberately left out)

## Goal

`buildStandaloneHtml` currently wraps the serialized body in a document whose only
CSS is the callout block. A user who exports a page and opens the `.html` (or hands it
to a CMS) sees unstyled headings, paragraphs, task lists, code, and blockquotes. This
ticket gives the standalone document a small, self-contained editorial stylesheet
covering every block node the editor can emit.

## Scope

In scope:

- One inline `<style>` in the exported document — no external stylesheets, fonts,
  scripts, or network requests.
- Editorial page layout (readable measure, system font stack, responsive padding).
- Heading levels `h1`–`h6`, paragraphs, bullet/ordered lists, task lists, inline code,
  fenced code blocks, blockquotes, horizontal rules, tables, images, links, and marks
  that do not carry inline styles.
- Callouts: per-type accent + tinted surface, title row, collapsed body hidden from the
  `data-callout-collapsed` attribute already emitted by the callout node. Untitled
  callouts get their type as a visible title (matching the editor node view) so a
  collapsed callout can never export as an empty coloured box.
- Wide tables scroll inside their own container instead of making the whole page
  scroll horizontally on narrow screens.
- Mention chips, because the HTML export schema already serializes mention nodes.

Out of scope:

- Making a fragment pasted into a CMS inherit these styles when the CMS strips the
  document `<head>`. The ticket explicitly specifies an inline `<style>` in the
  standalone document; CMS theme parity is the host's responsibility.
- A syntax-highlighting token palette. Lowlight spans keep their classes and inherit
  the code block's colour; the block itself is styled.
- Automatic dark-mode switching. The export is a portable document and uses one
  predictable light palette.
- Rewriting user content URLs. Links and images the user put in a page remain external
  references; the export shell itself adds no external requests.

## Decisions

### 1. One stylesheet constant in `lib/markdown-export.ts`

Replace the callout-only `CALLOUT_EXPORT_CSS` with a single `STANDALONE_EXPORT_CSS`
containing a small reset, the document/typography rules, and the callout rules. Keep
`buildStandaloneHtml(editorHtml, title)`'s signature unchanged; the call site in
`components/editor-workspace.tsx` needs no change.

CSS custom properties carry the palette so the callout rules stay short:

```css
.callout { --callout-accent: #57606a; --callout-surface: #f6f8fa; ... }
.callout-note, .callout-info { --callout-accent: #0969da; --callout-surface: #eef6ff; }
```

Unknown callout types (Obsidian passthrough) fall back to the neutral `.callout`
defaults.

### 2. No external resources

The stylesheet uses the platform system-font stacks
(`-apple-system, BlinkMacSystemFont, "Segoe UI", …` and
`ui-monospace, SFMono-Regular, Menlo, …`) and contains no `@import`, `@font-face`,
`url()`, `<link>`, or `<script>`. The exported file is fully offline-capable.

### 3. Callout state comes from existing markup, with a real fallback title

`Callout.renderHTML` emits `class="callout callout-<type>"`,
`data-callout-collapsed`, `.callout-title`, and `.callout-content`. The stylesheet
reads those attributes. The one node change is a shared `calloutDisplayTitle`
helper: untitled callouts now render their type as real title text (the same label
the React node view already shows). This keeps the title accessible (not a CSS
pseudo-element), avoids an empty box for `> [!note]-`, and matches the live editor.
The title lives outside `.callout-content`, so markdown/HTML round-trip is unchanged.
A collapsed callout stays collapsed in the static browser file (there is no script to
expand it); print reveals its body because paper cannot expand a collapse. Exported
task checkboxes are disabled and state-labelled so they cannot be toggled and lose the
change on reload.

### 4. Test at the export boundary

Tests assert the produced document, not the CSS string in isolation: serialize a real
page through the markdown engine, build the standalone document, and check that every
required block is present and that the stylesheet has a rule for it. Additional tests
guard the offline contract and callout state/type coverage.

### 5. Tables scroll via a wrapper, not `display: block`

An earlier cut made the `<table>` itself the scroller (`display: block;
overflow-x: auto`) and re-displayed `thead`/`tbody`/`tfoot` as tables. That turns
each section into an independent table, so a header row can compute different
column widths from the body it labels. Instead, `serializeExportBodyHtml` wraps
each top-level table in `<div class="table-scroll" tabindex="0" role="region"
aria-label="Table">` and the wrapper owns `overflow-x: auto`. The table keeps the
CSS table model and one shared column grid, and keyboard users can pan it.

The wrap is done by parsing the serialized body once (a `<template>` element),
not by scanning the string. Attribute values are serialized by ProseMirror with
`<`/`>` left unescaped — only `&` and `"` are escaped — so a string scanner will
match `<table></table>` inside an image `alt` or a callout title and inject a
wrapper whose quotes close the user's attribute. That turns inert text into live
markup in a file built for publishing (stored XSS), and an unbalanced token in an
attribute also disabled wrapping for the whole document. The same pass marks
task lists `role="list"` (WebKit drops the implicit role when
`list-style: none`). Both run only in the client export path and in jsdom tests;
on a server (no `document`) the pass returns the HTML untouched.

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| Exported `.html` opens in a browser with styled block nodes (incl. callouts) | Full-page serialization test + stylesheet selector coverage; Chromium check of a generated sample (below) |
| Export shell has no external resources; works offline | Test rejects network URLs, `@import`, `@font-face`, `<link>`, `<script>` in the export shell; browser load made one `file://` request and no console errors. Body links/images the user authored stay external by design (out of scope above) |
| Unit tests + lint + build green | Focused vitest suite, `npm run lint`, `npm run build` |

## Verification

- `npx vitest run tests/unit/markdown-export.test.ts tests/unit/callout.test.ts` —
  **80 passed / 2 files** (cycle 5).
- `npx vitest run tests/unit` — **81 files, 665 tests passed** (cycle 5).
- `npx eslint lib/markdown-export.ts lib/callout.ts components/callout-node-view.tsx tests/unit/markdown-export.test.ts tests/unit/callout.test.ts`
  — clean.
- `npm run typecheck` — clean.
- `npm run build` — Next.js production build succeeded (23 routes).
- Chromium (agent-browser) on a generated sample containing every block:
  - 375px viewport: page `scrollWidth` 375px; the 6-column table stayed inside its
    343px wrapper (`overflow-x: auto`), no page-level horizontal scroll.
  - 768px viewport: the table filled the 696px reading measure (row 695px) with
    collapsed 1px borders intact, and a header cell measured the same `left`/`width`
    as the body cell beneath it (single shared column grid).
  - Exported task checkboxes: `disabled`, `aria-label` set to `Completed` /
    `Not completed`, `pointer-events: none`, and not focusable. A bullet list nested
    inside a task item keeps `display: list-item` (markers visible) while task items
    stay `display: flex` rows.
  - Titled, untitled, collapsed, and unknown-type callouts all rendered the expected
    title/accent; collapsed bodies computed `display: none`; print media computed
    collapsed bodies as `display: block`. A callout typed `constructor` exports the
    title "Constructor" instead of failing on an inherited object key.
  - One stylesheet, zero `<link>`/`<script>` elements, no console errors.
- Injection probe (cycle 5): image `alt` and `data-callout-title` values containing
  `<table></table><img src=x onerror=…>` / `<script>…</script>` stay inside their
  attributes — the parsed body has no injected `script`, no second `img`, and the
  attribute text is preserved. An unbalanced `<table` in another attribute no longer
  suppresses the wrapper for the real table.
- Stylesheet contracts are asserted through the CSSOM: print-only overrides
  (collapsed reveal, `overflow: visible`, wrapping code) live inside the `@media print`
  rule and not in top-level rules; the `.mention` colour resolves to `#92400e`
  (≥ 5.8:1 on every surface it sits on).
