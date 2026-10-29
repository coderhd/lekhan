# Clean-room review — #74 Export: styled standalone HTML

**Ticket:** #74 (SIL-10) · **Branch:** `feat/74-styled-standalone-html`,
`fix/74-export-table-wrapper-xss` · **Base:** `origin/main` ·
**Commits:** `8eb4b12`, `cc5b89c`, `8aca565`, `a721bd4`, cycle-5 fix
**Reviewer:** independent clean-room reviewer (separate context, no implementation work)
**Verdict:** **APPROVE** (cycle 3) · bot-review findings fixed in cycle 4 ·
**cycle 5 (post-merge clean-room): CHANGES REQUESTED → fixed** — see finding 1

## Scope reviewed

`git diff origin/main...HEAD`:

- `lib/markdown-export.ts` — self-contained `STANDALONE_EXPORT_CSS`, static task
  checkbox serialization.
- `lib/callout.ts` — shared `calloutDisplayTitle` fallback.
- `components/callout-node-view.tsx` — uses the shared fallback title.
- `tests/unit/markdown-export.test.ts`, `tests/unit/callout.test.ts` — coverage.
- `docs/superpowers/specs/74-spec.md` — spec and verification record.

No storage/CRDT/backend paths touched. `buildStandaloneHtml` signature unchanged.

## Findings resolved

| Cycle | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | MEDIUM | Untitled collapsed callout exported as an empty coloured box; type conveyed by colour alone | Shared `calloutDisplayTitle` renders a real fallback title (`Note`, `Warning`, …, or a capitalised unknown type) in both `renderHTML` and the node view; test added |
| 1 | MEDIUM | Tiptap table inline `min-width` caused page-wide horizontal scroll on narrow screens | Table is a block scroll container with `min-width: 0 !important`; inner `tbody` fills the measure. Chromium: 768px row 695/696px, 375px page `scrollWidth` 375 |
| 1 | LOW | `h4`/`h5`/`h6` visually identical | Distinct sizes; `h6` muted |
| 1 | LOW | Print could orphan headings; collapsed content vanished on paper | `break-after: avoid` on `h1`–`h3`; print reveals collapsed bodies |
| 1 | LOW | Export checkboxes were live but state was not persisted | Serializer emits `disabled` + `aria-label="Completed"/"Not completed"`; pointer events off |
| 2 | MEDIUM | `display: block` made `width: 100%` inert (shrink-to-fit tables) | Inner `thead`/`tbody`/`tfoot` render as full-width tables; verified in Chromium |
| 2 | MEDIUM | Disabled-by-pointer only was still keyboard-focusable and unnamed | Serializer `disabled` removes focus; `aria-label` names the state; verified `focus()` does not move `activeElement` |
| 2 | LOW | Offline guard missed relative `url()` targets | Test rejects every `url()` target except `data:` |
| 2 | LOW | Print/static behavior undocumented in the spec | Documented in spec decision 3 |
| 4 | **BLOCKER** | Accepted custom types colliding with inherited object keys (`constructor`, `toString`) resolved to a function in `calloutDisplayTitle`; `generateHTML` then rejected it and HTML export failed | Own-property lookup against `DEFAULT_CALLOUT_TITLES` before the capitalised fallback; same guard in the node-view icon lookup; tests cover three inherited-key types |
| 4 | MINOR | `calloutDisplayTitle` threw on a `null`/`undefined` title from JSON input | Signature accepts `string \| null \| undefined`; title normalises with `title?.trim() ?? ''`; test asserts `attrs.title: null` exports the type title |
| 4 | MAJOR | `display: block` on the table turned `thead`/`tbody`/`tfoot` into separate tables, so headers could compute different column widths from their body | Serializer wraps each top-level table in `<div class="table-scroll">` (depth-aware); the wrapper owns `overflow-x: auto` and the table keeps one CSS table grid. Chromium: header and body cell share the same `left`/`width` |
| 4 | MINOR | `ul[data-type="taskList"] li` applied flex layout to ordinary lists nested inside a task item, dropping their markers | Selectors narrowed to `ul[data-type="taskList"] > li` (and its `> label` / `> div` children); Chromium: nested bullets are `display: list-item`, task rows stay flex |
| 5 | **BLOCKER** | The cycle-4 string scanner inserted `<div class="table-scroll">` into attribute values. ProseMirror does not escape `<`/`>` in attributes, so an image `alt` or `data-callout-title` containing `<table></table>` broke out of the quoted value and turned user text into live markup (stored XSS in the published file) | The presentation pass now parses the serialized body with a `<template>` and wraps `table` elements structurally, so table-like text inside an attribute stays inert. Regression tests use the reviewer's payloads (`alt` and callout title) and assert zero injected `script`/`img[onerror]` and preserved attribute text |
| 5 | MINOR | An unbalanced `<table` in an attribute aborted wrapping for the whole document | Structurally impossible now: attribute text is never scanned. Test covers an image alt with a literal `literal <table text` next to a real table |
| 5 | MINOR | Table wrapper was not keyboard-scrollable (WCAG 2.1.1) | Wrapper carries `tabindex="0"`, `role="region"`, `aria-label="Table"` |
| 5 | MINOR | `.mention` text was 4.48:1 on white and 4.09–4.26:1 on tints (below AA for 14px/500) | Colour darkened to `#92400e` (6.3:1 white, ≥5.8:1 worst-case tint); pinned by a test |
| 5 | MINOR | Print left `overflow: auto` on tables and `pre`, clipping wide content on paper | Print block resets `overflow: visible`, `pre code { white-space: pre-wrap }`, `table { width: auto; break-inside: auto }`; tested through CSSOM inside the `@media print` rule |
| 5 | MINOR | `calloutDisplayTitle` threw on non-string attrs (`title: 123`) | `typeof … === 'string'` guards; test covers numeric attrs |
| 5 | MINOR | CSS tests asserted source text, so a print-only rule moved to screen would still pass | Print test parses the stylesheet and asserts the collapsed/overflow overrides live in the `print` media rule and not in top-level style rules |
| 5 | NIT | `list-style: none` drops list semantics in WebKit/VoiceOver | Serializer sets `role="list"` on `ul[data-type="taskList"]` |
| 5 | NIT | Callout had no grouping role in the static export | `renderHTML` emits `role="note"` |

## Final evidence

- `npx vitest run tests/unit/markdown-export.test.ts tests/unit/callout.test.ts` — **80 passed / 2 files** (cycle 5)
- `npx vitest run tests/unit` — **81 files, 665 tests passed** (cycle 5; re-run after one flake in the unrelated `sync-snapshot-debounce` timing test)
- `npx eslint lib/markdown-export.ts lib/callout.ts components/callout-node-view.tsx tests/unit/markdown-export.test.ts tests/unit/callout.test.ts` — clean
- `npm run typecheck` — clean
- `npm run build` — Next.js production build succeeds (23 routes)
- Chromium (agent-browser), regenerated sample with every block at 375px and 768px:
  - no page-level horizontal scroll; wide tables scroll inside `.table-scroll`
  - header and body cell share one column grid (same `left`/`width` at 768px)
  - task checkboxes not focusable, state-labelled, checked state visible; bullet lists
    nested in a task item keep `display: list-item` markers
  - titled/untitled/collapsed/unknown callouts render the expected title and accent,
    including a `constructor`-typed callout; collapsed body `display: none` on screen,
    `display: block` in print
  - one stylesheet, zero `<link>`/`<script>`, no console errors
- Escaping/XSS probe (corrected in cycle 5 — the cycle-3 record was too narrow): image
  `alt` and `data-callout-title` payloads of `a <table></table><img src=x onerror=alert(1)>`
  and `t <table></table><script>alert(2)</script>` parse to **zero** injected elements,
  with the attribute text preserved verbatim. `buildStandaloneHtml` neutralises
  `</title><script>` in the document title.
- Round-trip probe: `> [!warning]-` → fallback title, empty `data-callout-title`,
  markdown unchanged, HTML→md→HTML stable.

## Non-blocking notes

- ~~`tbody` becoming its own table normalises authored column widths; acceptable for
  readable responsive export. Revisit with a scroll `<div>` wrapper if width fidelity
  becomes a requirement.~~ Implemented in cycle 4 (spec decision 5): the table stays a
  table and `.table-scroll` owns the horizontal scroll.
- The offline `url()` assertion can be tightened further if data URIs ever include
  whitespace after `(`; the stylesheet currently has no `url()` at all.
