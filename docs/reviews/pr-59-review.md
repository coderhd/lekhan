# Clean-Room Review — PR 59 / SIL-59 (S3 clipboard copy-out)

**Reviewer:** independent Clean-Room Reviewer (did not write this code)
**Worktree:** `/Users/harshdave/Desktop/projects/lekhan-worktrees/sil-59-clipboard-copy`
**Branch:** `feat/59-clipboard-copy` (merge-base `2ea8018` = current `origin/main`)
**Scope reviewed:** `git diff origin/main...HEAD` — 5 commits, 11 files, +1151/−23
**Spec:** `docs/superpowers/specs/59-spec.md`
**Date:** 2026-10-27

## Verdict: REQUEST CHANGES

Two defects are reproducible on the primary user path and one acceptance
criterion is backed by evidence that is not what the spec asks for. The
architecture (engine profile → pure payload builder → serializer → copy seam) is
sound, the scope is clean, and the build gate is green; the problems below are
concrete behaviour bugs, each with a small fix.

### Gate evidence (Stage 4 re-run by reviewer)

```
npm run typecheck        -> clean
npm run lint             -> clean
npm test                 -> 85 files / 716 tests passed
npm run build            -> succeeded
```

Reproductions below were run against the branch with throw-away vitest files
(deleted afterwards; `git status` clean at review time).

---

## Findings

### 1. BLOCKER — "Copy for Notion (rich)" prepends an empty `<h1></h1>` to every real Page

**Where:** `lib/markdown/clipboard.ts:103-110` (the `html` branch at `:109`),
`lib/markdown/notion-html.ts:126-131`; related existing behaviour
`lib/markdown-export.ts:77`.

**Scenario.** Every live Page doc is seeded with an empty leading H1
(`services/obsidian-import.ts:406-409`, and `engine.ts:51` re-adds one for docs
that do not start with a heading; the schema is `heading block*`,
`lib/editor-extensions.ts:28-30`). `buildClipboardPayload` strips that
placeholder only on the markdown side, because the strip happens *inside*
`serializeObsidianBody` (`engine.ts:215`). The doc handed to
`serializeNotionHtml` is the unstripped `normalized` doc, so the Notion payload
starts with an empty heading.

**Observed** (live-shaped doc: `[empty h1, paragraph "Body"]`, whole page,
`target: 'notion'`):

```json
{
  "text": "---\ntitle: My Page\ntags:\n  - x\n---\nBody\n",
  "html": "<h1></h1><p>Body</p>"
}
```

Pasting into Notion therefore creates an empty heading block above the page
content — i.e. the Notion acceptance path does **not** "convert cleanly". This
also diverges from the shipped `.html` export, which explicitly strips the
placeholder before `generateHTML` (`lib/markdown-export.ts:77`; covered by
`tests/unit/markdown-export.test.ts:251`). The tests cannot catch it because
every payload test builds its doc with `engine.parse('# Title…')`, which has a
non-empty heading and never reproduces the live placeholder.

**Minimal fix.** Strip once and use the same doc for both representations:

```ts
const normalized = stripAutoHeading(normalizeClipboardDoc(doc))
```

in `buildClipboardPayload` (export `stripAutoHeading` from the engine import
already used there), keep the internal strip in `serializeObsidianBody`
(idempotent), and add a regression test that asserts
`buildClipboardPayload(liveShapedDoc, …).html` does **not** contain `<h1></h1>`.

---

### 2. MAJOR — An aliased wikilink inside a table corrupts the copy-out payload

**Where:** `lib/markdown/engine.ts:101-107` (`restoreWikilinks`, applied to the
whole serialized string at `:215`).

**Scenario.** `restoreWikilinks` strips the bracket escapes unconditionally,
including inside GFM table rows, where `|` is a column delimiter and must stay
escaped (`\|`). The wikilink alias pipe is exactly that delimiter.

**Observed** — doc parsed from
`| Page | Note |\n| --- | --- |\n| [[Beta\|the beta]] | x |`:

```
serializeExport(stripAutoHeading(doc)) -> "| \[\[Beta|the beta\]\] | x |"
serializeObsidianBody(doc)             -> "| [[Beta|the beta]] | x |"      (after restore)
engine.parse(serializeObsidianBody(doc)) -> row now has 4 cells:
    "[[Beta" | "the beta]]" | ...            -> IR identity false
```

So the text/plain payload handed to Obsidian contains a broken table (extra
column, dead link), and the S3 round-trip guarantee fails for the
table + alias-wikilink combination. Both constructs are individually in
`CORPUS` (`tests/unit/clipboard.test.ts:15-30`) but not in combination, which is
why the suite is green. Root cause is partly pre-existing (tiptap-markdown does
not escape `|` in cell text either), but S3 owns the new `restoreWikilinks`
pass, the alias form is called out in the spec's construct table, and the copy
payload is this slice's deliverable.

**Minimal fix.** Make the restore pass line/section aware: skip fenced code
blocks and inline code spans, and for lines that parse as table rows re-emit the
alias pipe escaped (`[[Beta\|the beta]]`) instead of a bare `|`. Add the
combined corpus case `| Page |\n| --- |\n| [[Beta\|alias]] |` to the round-trip
and idempotence tests.

---

### 3. MAJOR — Default ⌘C into Notion now pastes YAML frontmatter and literal callout markers (AC1 conflict)

**Where:** `components/editor-workspace.tsx:645-661` (payload at `:653`), with
`lib/markdown/clipboard.ts:52-60` and spec §6.2.1.

**Scenario.** For any whole-page copy (`⌘A`, `⌘C`) the handler writes the
`obsidian` target: `text/plain` only, with frontmatter. Notion sees no
`text/html`, so it converts the raw text. The first thing the user pastes into
Notion is:

```
---
title: Dual-Dialect Interop Bridge
tags:
  - interop
  - obsidian
---
```

followed by `> [!note] …` callout markers as literal quote text. Acceptance
criterion 1 says the copy "pastes into a real Notion page and converts cleanly";
that is only true via the explicit `Copy for Notion (rich)` menu item. The code
matches spec §6.2.1, so this is a **spec/AC conflict that must be resolved
explicitly**, not silently shipped: either (a) omit frontmatter from the
implicit ⌘C payload (frontmatter only for the explicit "Copy as Obsidian
markdown" action), (b) add a target-aware affordance for ⌘C, or (c) amend AC1
and record the intentional degradation.

Secondary regression in the same line: before this change ProseMirror wrote
`text/html` for every copy (tiptap-markdown only transformed `text/plain`), so
⌘C → Google Docs / Word / email preserved formatting. Now every ⌘C in the
editor yields plain markdown source for those targets too. That is a real
product change worth a deliberate decision, not only a test gap.

---

### 4. MAJOR — AC1's "captured from the real apps" fixtures are self-generated, and the QA dogfood is not recorded

**Where:** `tests/fixtures/clipboard/obsidian-page-copy.md`,
`obsidian-page-copy.html`, `obsidian-page-copy.clipboard.json`;
assertion at `tests/unit/clipboard.test.ts:296-302`.

**Scenario.** `obsidian-page-copy.html` is asserted to be byte-identical to
`serializeNotionHtml(doc)`, i.e. it is a golden output of this branch, not a
clipboard capture taken from Notion. `obsidian-page-copy.clipboard.json` is
likewise the serializer's own output (frontmatter key order `author, status,
title, tags` is what `matter.stringify` emits, not what the hand-written `.md`
fixture shows), and neither file carries `source`/`recordedAt` metadata the way
the S1 captures (`tests/fixtures/clipboard/notion-page.json`,
`obsidian-note.json`) do. Nothing in the repo records the SIL-70 dogfood that
the ticket cites (`grep -R "SIL-70\|dogfood" docs` → only the spec).

The golden-anchor tests themselves are useful and should stay — they just are
not the evidence AC1 asks for. Without a real capture, "Notion converts cleanly"
(including the `<li><input type="checkbox" disabled> <p>…</p></li>` task-item
shape and the callout `class="callout …"` blockquotes, which Notion strips)
remains unverified.

**Minimal fix.** Add `source`/`recordedAt` provenance to the new fixtures and
commit the actual real-app paste result (Notion's post-paste block structure or
a screenshot note) plus the QA sign-off under `docs/reviews/` (or a QA note).
If a real capture is impossible, soften the fixture name/claim to "golden
regression anchor" and get AC1 amended rather than letting a generated file
stand in for a capture.

---

### 5. MINOR — Highlight is in the spec's construct table but is neither tested nor emitted as the Obsidian dialect

**Where:** `tests/unit/clipboard.test.ts:15-30` (`CORPUS`), `engine.ts:214-216`.

`==highlight==` / `<mark>` is promised in spec §5. `engine.parse('==mark==')`
produces plain text (no highlight input rule), and a live doc with a highlight
mark serializes to raw HTML in `text/plain`:

```
serializeObsidianBody(highlightDoc)
  -> 'plain <mark data-color="#ffcc00" style="background-color: rgb(255, 204, 0); color: inherit;">marked</mark> text\n'
serializeNotionHtml(highlightDoc)
  -> '<p>plain <mark>marked</mark> text</p>'      // this side is correct
```

It renders in Obsidian (HTML is valid there), but it is not the `==…==` form the
spec table specifies, and no test covers it. `<u>` does round-trip as `<u>`, so
underline is fine. **Fix:** add both to `CORPUS`; either implement `==`
serialize/parse or amend the spec table to "HTML-in-markdown on the plain-text
side", so the contract matches reality.

---

### 6. MINOR — `restoreWikilinks` silently rewrites code spans/blocks

**Where:** `lib/markdown/engine.ts:103-107`.

Same context-blind pass as #2. Repro: doc text `` Use `arr\[\[i\]\]` syntax. ``
→ copy-out text/plain becomes `` Use `arr[[i]]` syntax. `` (backslashes removed
from code). A code block containing `/\[\[([^\]]+)\]\]/g` is preserved only
because that particular bracket run does not form a complete `\[\[ … \]\]`
match. Silent mutation of user code is not acceptable on a copy path; fix with
the code-aware pass from #2 (apply the restore to text nodes / skip code
ranges).

---

### 7. MINOR — Clipboard metadata ref goes stale after a paste that changes properties

**Where:** `components/editor-workspace.tsx:168-176` (title mirror),
`:197` and `:213` (properties/tags mirrored once on mount), `:723`
(`updatePageProperties` on paste).

The ref is only hydrated by the mount effect. The paste handler merges pasted
page properties into the current page server-side but never updates
`clipboardMetaRef.current.properties` (or refetches tags), so the next ⌘C emits
the pre-paste values. Repro: Page A `{status: draft}`, copy Page B
`{status: final}` into A, immediately copy A → frontmatter still says
`status: draft`. **Fix:** after `updatePageProperties` resolves, refresh
`clipboardMetaRef.current.properties` (and tags) — e.g. re-run
`fetchPageDetails` / `fetchPageTags` in the `.then`, or apply the merged patch
locally.

---

### 8. MINOR — "Copy for Notion" fails closed when the rich-clipboard API is unavailable

**Where:** `lib/markdown/clipboard.ts:133-150`.

`copyClipboardPayloadToSystem` returns `false` for any `clipboard.write` /
`ClipboardItem` failure (older Firefox, permission denial, insecure context,
Safari quirks), and `handleCopyFor` then shows "Could not access the clipboard"
without ever trying `writeText`. The markdown payload is already built at that
point, so the user gets nothing for a target that is perfectly serviceable as
plain text. **Fix:** on failure of the rich write, retry
`navigator.clipboard.writeText(payload.text)`; only report failure if both
attempts fail. Guard `typeof ClipboardItem === 'undefined'` up front.

---

### 9. MINOR — `href`/`src` are attribute-escaped but not scheme-validated

**Where:** `lib/markdown/notion-html.ts:24-33`, `:65-70`, `:152-158`.

Quoting is safe (no attribute breakout — verified with hostile
callout-type/language/alt/title values), but a `link` mark whose href is
`javascript:…` is emitted verbatim:

```html
<a href="javascript:alert(1)">click</a>
```

Markdown parse rejects that URL and tiptap Link validates on HTML parse, so
normal authoring cannot create it — but collaboration/doc-JSON hydration
(`setContent`) does not re-validate mark attrs, and the payload is then handed
to whatever app the user pastes into. **Fix:** allowlist `http:`, `https:`,
`mailto:`, relative paths (and `obsidian:` if intended) for href, `http(s)`/
`data:image` for `img src`; render children/text when rejected.

---

### 10. MINOR — No test for the copy-event handler itself

**Where:** `components/editor-workspace.tsx:645-661`; spec §9 asks for "a jsdom
copy-event smoke test where feasible".

`buildClipboardPayload` / `writeClipboardPayload` are well covered, but nothing
exercises the seam that actually ships: whole-page detection
(`from <= 0 && to >= size`), the meta ref wiring, `preventDefault()` only after
a successful write, and the native-copy fallback. The repo already has jsdom
Tiptap test infrastructure (`tests/unit/table-persistence.test.tsx`). A single
test dispatching a `ClipboardEvent('copy')` on `editor.view.dom` with a stub
`clipboardData` would lock the contract in.

---

### 11. NIT — Menu semantics / small component hygiene

- `components/editor-workspace.tsx:1095` — the divider is a bare `<div>` inside
  `role="menu"`; give it `role="separator"` (and consider `role="none"` on the
  wrapper `<div>`s so the menu's owned children are the `menuitem`s).
- `:1098-1110` — new copy items are not `disabled={isExporting}` like the export
  items, so a double click can run two clipboard writes.
- `:296-297` — `if (!editor) return` bypasses the `finally`, leaving the menu
  open on that (rare) path.

### 12. NIT — Empty page title serializes an empty frontmatter value

`engine.ts:167-177` + `clipboard.ts:71-76`: an untitled page copies as
`title: ''`, which Obsidian shows as an empty Title property and
`parseFrontmatter` then drops (trim). Omit an empty title in `pageMetaToData`
or in `toPageMeta`.

### 13. NIT — Two imports from the same module

`lib/markdown-export.ts:5-6` — merge into one `import { markdownEngine, stripAutoHeading, type PageMeta } from '@/lib/markdown/engine'`.

### 14. NIT — The "leaked inline nodes" test asserts a state `Node.cut` cannot produce

`lib/markdown/clipboard.ts:60-85` and `tests/unit/clipboard.test.ts:236-249`.
`Fragment.cut` preserves block structure (it recurses into the top-level
children), so a real selection cut never yields doc-level text/hardBreak nodes;
the fabricated doc in the test is unreachable. The normalizer is harmless
defence in depth — but the untested realistic cases are partial **table** (cell
range) and partial **list** selections. Cover those instead (and #2's table
case) so the guarantee has teeth.

### 15. NIT — "Property test" is a table-driven loop

Spec §7 / §9 say "property test"; the implementation is a fixed `for` loop over
`CORPUS` (`tests/unit/clipboard.test.ts:33-52`). Fine if that is the intent,
but either add a generator (e.g. fast-check over construct combinations) or
adjust the wording — construct *combinations* are exactly where #2 slipped
through.

---

## Verified as correct (no finding)

- **Scope:** no `lib/markdown-io.ts` touched (already retired), all serializer
  work on `lib/markdown/engine.ts`; `stripAutoHeading` moved with an identical
  body; web/desktop share one module; no sync wording in any new copy
  affordance or toast ("Copy as Obsidian markdown", "Copy for Notion (rich)",
  "Copied for Notion").
- **Copy seam ordering:** `prosemirror-view` runs `props.handleDOMEvents`
  before its built-in handler (`node_modules/prosemirror-view/dist/index.cjs`
  `initInput` → `!runCustomHandler(view, event) && handler(...)`), so returning
  `true` genuinely suppresses ProseMirror's own `text/html` write and returning
  `false` genuinely restores native copy. `preventDefault()` is only called
  after `writeClipboardPayload` returned `true`; serializer exceptions are
  caught → `console.warn` → `false` (native fallback). No unhandled promises
  (`handleCopyFor` catches and has `finally`).
- **Target tuning (SIL-68):** `target: 'obsidian'` yields `html === ''`;
  `writeClipboardPayload` skips the empty MIME; `copyClipboardPayloadToSystem`
  uses `writeText` for plain-only. The ⌘C handler really does write only
  `text/plain`.
- **Frontmatter/YAML safety:** multiline strings, `---` inside values, quotes,
  `#`, arrays, nested objects, numbers, and dates all round-trip through
  `matter.stringify`/`parseFrontmatter` correctly (values are YAML-quoted, no
  body leakage). Reserved `title`/`tags` are not duplicated. Empty meta returns
  the bare body.
- **HTML escaping:** `<script>`, `&`, `"` in text and in
  callout-type/language/alt/title attributes are escaped; no attribute breakout
  from hostile attr values.
- **Constructs verified round-trip through the real S1 routing**
  (`classifyClipboardPaste` → `splitObsidianFrontmatter` → parser): headings,
  marks, links, nested bullet/ordered lists, tasks, blockquote, callout, code,
  table, wikilinks (plain + alias in prose/list/heading), tags, image, hr,
  hard break, mention, textStyle colour, underline.
- **Anon visitor / rebase check:** `anonVisitor` is a context line from main,
  not a conflict artifact. `if (pageId && !anonVisitor)` now guards all three
  fetches, and the effect deps `[pageId, anonVisitor]` cover both inputs —
  anonymous visitors issue no tag/property fetch and the copy payload carries
  only the public title (`isViewer` also hides the Export menu). Note:
  `fetchPageDetails` at `editor-workspace.tsx:354` (the role check) still runs
  for anon — that is pre-existing on `origin/main`, not introduced here.
- **DoD:** typecheck, lint, full test suite, and production build all pass
  (output above).

## Recommended order to land

1. #1 (one-line strip; unblocks the Notion acceptance path).
2. #2 + #6 (one code-aware `restoreWikilinks` pass; add the combined corpus
   case).
3. #3 decision + #4 evidence (product/spec call, not purely code).
4. #5, #7-#10 as follow-ups in the same PR if cheap; #11-#15 cleanup.
