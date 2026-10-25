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

### 4. Test at the export boundary

Tests assert the produced document, not the CSS string in isolation: serialize a real
page through the markdown engine, build the standalone document, and check that every
required block is present and that the stylesheet has a rule for it. Additional tests
guard the offline contract and callout state/type coverage.

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| Exported `.html` opens in a browser with styled block nodes (incl. callouts) | Full-page serialization test + stylesheet selector coverage; Chromium check of a generated sample (below) |
| No external resources; works offline | Test rejects network URLs, `@import`, `@font-face`, `<link>`, `<script>` in the export shell; browser load made one `file://` request and no console errors |
| Unit tests + lint + build green | Focused vitest suite, `npm run lint`, `npm run build` |

## Verification

- `npx vitest run tests/unit/markdown-export.test.ts tests/unit/callout.test.ts` —
  **62 passed / 2 files**.
- `npx eslint lib/markdown-export.ts lib/callout.ts components/callout-node-view.tsx tests/unit/markdown-export.test.ts`
  — clean.
- `npm run typecheck` — clean.
- `npm run build` — Next.js production build succeeded (23 routes).
- Chromium (agent-browser, 375px viewport) on a generated sample containing every
  block: page `scrollWidth` stayed at 375px; the 6-column table stayed inside its
  343px container; task checkboxes had `pointer-events: none`; titled, untitled,
  collapsed, and unknown-type callouts all rendered the expected title/accent;
  collapsed bodies computed `display: none`; one stylesheet, zero `<link>`/`<script>`
  elements; no console errors.
