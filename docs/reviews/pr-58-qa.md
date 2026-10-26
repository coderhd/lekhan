# QA review — SIL-58 / PR #151 Notion import (zip route)

**QA Engineer · SIL-100 gate · 2026-10-26**
**Branch reviewed:** `feat/58-notion-import-zip` @ 4aa8ad8

## Verdict: **CHANGES** — one blocking finding

Everything else on the gate checklist passes. One silent data-loss bug in the callout
conversion must be fixed before this merges.

## Checklist results

### 1. Spec / review record ↔ four acceptance areas

- **AC1 fixtures incl. multi-part** ✅ — `basic-export.zip` covers UUID-suffixed
  files/folders, `Private & Shared` wrapper, `_all.csv` + view CSV, row Markdown pages
  incl. a CSV-only row, relative UUID link, `notion.so` relation link, unresolved link,
  resolved image, broken image, non-image PDF, HTML callout, synced marker,
  `__MACOSX/` + `.DS_Store`. `multi-part/*.zip` models `Export-…` split parts with a
  duplicate page UUID.
- **AC2 DB rows → Pages with CSV properties** ✅ — all CSV columns (including
  Formula/Rollup as static strings and the title column) land on the row Page;
  CSV-only rows survive with an empty body.
- **AC3 IR-identity** ✅ — serialize → reimport preserves titles and `plainText`
  byte-for-byte, 24-case generated matrix is serialization-idempotent, and the
  fingerprint is stable per ingestion but producer-distinct (`notion` ≠ `obsidian`).
- **AC5 honest report** ✅ — all five categories (views → H2 #47, synced blocks,
  comments, formulas/rollups, attachments) render even at zero counts; wording
  matches the spec's marketing constraint.

### 2. Tests assert external behaviour

`notion-import-read` (11), `notion-import` (24), `notion-import-identity` (4) assert
titles, `plainText`, rendered editor HTML and report fields — no internals asserted.
Fence/inline-code safety, unrepresentable titles, executable schemes and the
multi-part merge are all behaviour-level tests. ✅

### 3. Verification (branch @ 4aa8ad8)

```
npm run typecheck   # clean
npm run lint        # clean
npm test            # 86/87 files, 728/729 tests pass
npm run build       # Next.js production build succeeds
```

The single failing test — `tests/unit/sync-snapshot-debounce.test.ts > "serializes
concurrent saves for the same document"` (5 s timeout) — **fails identically on
`main` @ 9954aaf** and the branch touches neither that file nor `lib/` sync code.
Pre-existing environment/timing flake, not a PR #151 regression.

### 4. Dogfood

An independent synthetic export (fresh-built from Notion's documented export
conventions, deliberately different from the committed fixtures: dashed-UUID link
paths, root-level database CSV, `Export-<name>` wrapper, title-suffix-stripping page
titles, 3-view CSV, BOM/CRLF/quoted commas, deeper nested row body, image + PDF) was
run through `readNotionZips → importNotionExport`. Results:

- 8 clean titles, no 32-hex suffixes; two folder pages; two folder pages ✅
- 3 links resolved (relative, `notion.so`, dashed-UUID), 0 unresolved ✅
- 2 DB rows with full CSV column properties; CSV-only row kept ✅
- image resolved to data URL; PDF attachment counted with label kept ✅
- report named all five degradation lines verbatim ✅

**Confirmed bug during dogfood — see below.**
A genuine Notion-account export could not be obtained in this run (no Notion
connection); the independent synthetic dogfood above plus Dev's post-fix fixture
must be re-verified against a real export before merge.

## Blocking finding — B1

| Field | Value |
|---|---|
| Severity | BLOCKING (silent content loss) |
| Where | `services/notion-import.ts`, `CALLOUT_TABLE_RE` / `unwrapCallouts` |
| Trigger | Any `<table>` — multi-cell (3+ `<td>`) or multi-row — anywhere outside a fence |
| Observed | Converted into a callout; structural cells dropped |

**Root cause.** The lazy second capture `([\s\S]*?)` in `CALLOUT_TABLE_RE` backtracks
across cell boundaries to close the match. For
`<table><tr><td>x</td><td>y</td><td>z</td></tr></table>` it matches with
`icon="x"` and `content="y</td><td>z"`, so `stripHtml` yields `yz` — the first cell
becomes a "short icon" the `icon.length > 8` guard lets through. For a
`<table><tr><td>r1a</td><td>r1b</td></tr><tr><td>r2a</td><td>r2b</td></tr></table>`
two-row table it matches with `content="r1b</td></tr><tr><td>r2a</td><td>r2b"`,
yielding the single callout body `r1br2ar2b`. Both were observed in the dogfood run.

**Expected.** Only a genuine one-row/two-cell table (Notion's callout shape — a short
icon cell and a text cell, with no further `<td>` inside either capture) converts.
Any other table must pass through as a table (or, if unrepresentable, be reported as
a degraded block) — never silently collapse into a callout text.

**Fix (Dev).** Require the captures to be free of `</td>`/`<td>`: e.g.
`<td>([^<]|(?:<(?!/?(?:td|tr|table)\b))[\s\S]*?)<\/td>` for both cells and keep the
existing guard, then pass through whole. (Suggested shape — Dev's call.) Add:
1. a 3-cell single-row HTML table passes through intact;
2. a 2×2 HTML table passes through intact (no callout, no cells lost).

Fixture gap that allowed this: only the exact 1×2 callout shape was ever in a
fixture or test — add a non-callout HTML table fixture entry as part of the fix.

## Non-blocking notes

- Unreferenced non-page files (e.g. `README.txt`, a PDF nobody links) are skipped
  silently; acceptable, since dropped attachments are counted per link. A report
  line "N unreferenced files skipped" would be nicer.
- 4-space-indented code blocks remain unguarded (already accepted; Notion emits
  fenced code).
- Real-export dogfood cannot be signed off without an actual Notion export zip —
  re-run it after the B1 fix (provider/export instructions live in the spec §D7).

## Dev response — B1 fixed

**Dev Engineer, same branch — patch after `b74558a`.**

`CALLOUT_TABLE_RE` still describes the one-row/two-cell shape, but a match is now rejected
when either capture contains a `<td>`/`<tr>`/`<table>` tag (`CALLOUT_CELL_STRUCTURE_RE`).
Those tags only appear when the lazy captures backtrack across a cell/row boundary, so a
3-cell row or a multi-row table can no longer masquerade as a callout with a "short icon";
the whole table is returned untouched and counted in `degradedBlocks`.

Regression coverage:
- `tests/fixtures/notion/html-tables.zip` — a real callout beside a 3-cell row and a 2×2
  table.
- `notion-import.test.ts > converts only the genuine one-row/two-cell callout shape and
  keeps real HTML tables` asserts the callout renders once, all seven table cells survive,
  two `<table>` elements remain, and both tables are named as degraded blocks.

Verification re-run on the fixed branch: typecheck, lint, full `npm test` (87 files / 735
tests) and production build are green. The QA dogfood + real-export sign-off is
outstanding and is the only remaining gate.
