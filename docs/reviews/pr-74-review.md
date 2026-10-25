# Clean-room review — #74 Export: styled standalone HTML

**Ticket:** #74 (SIL-10) · **Branch:** `feat/74-styled-standalone-html` ·
**Base:** `origin/main` · **Commits:** `8eb4b12`, `cc5b89c`, `8aca565`
**Reviewer:** independent clean-room reviewer (separate context, no implementation work)
**Verdict:** **APPROVE** (cycle 3)

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

## Final evidence

- `npx vitest run tests/unit/markdown-export.test.ts tests/unit/callout.test.ts` — **67 passed / 2 files**
- `npx vitest run tests/unit` — **81 files, 647 tests passed**
- `npx eslint lib/markdown-export.ts lib/callout.ts components/callout-node-view.tsx tests/unit/markdown-export.test.ts tests/unit/callout.test.ts` — clean
- `npm run typecheck` — clean
- `npm run build` — Next.js production build succeeds (23 routes)
- Chromium (agent-browser), generated sample with every block at 375px and 768px:
  - no page-level horizontal scroll; wide tables scroll internally
  - 1px collapsed table borders, `th` background intact
  - task checkboxes not focusable, state-labelled, checked state visible
  - titled/untitled/collapsed/unknown callouts render the expected title and accent;
    collapsed body `display: none` on screen, `display: block` in print
  - one stylesheet, zero `<link>`/`<script>`, no console errors
- Escaping/XSS probe: title and callout attrs remain inert; no tag breakout.
- Round-trip probe: `> [!warning]-` → fallback title, empty `data-callout-title`,
  markdown unchanged, HTML→md→HTML stable.

## Non-blocking notes

- `tbody` becoming its own table normalises authored column widths; acceptable for
  readable responsive export. Revisit with a scroll `<div>` wrapper if width fidelity
  becomes a requirement.
- The offline `url()` assertion can be tightened further if data URIs ever include
  whitespace after `(`; the stylesheet currently has no `url()` at all.
