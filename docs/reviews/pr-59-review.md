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

---

## Round 2 verification — 2026-10-27

**Reviewer:** same independent Clean-Room Reviewer, second pass (did not write this code)
**Head verified:** `6e57d01` (`fix(59): clean-room review — Notion placeholder heading, table-safe wikilinks, URL + clipboard hardening`), branch `feat/59-clipboard-copy` on `origin/main` (`2ea8018`)
**Method:** read the remediation diff in full; reproduced each claimed fix with throw-away vitest files (deleted afterwards — `git status` shows only this review file as modified); read the component/server paths for the races that cannot be unit-driven; ran the full gate on the clean tree.

### Gate evidence (Stage 4 re-run by reviewer on `6e57d01`)

```
npm run typecheck        -> tsc --noEmit, exit 0
npm run lint             -> eslint ., exit 0
npm test                 -> 85 files / 728 tests passed (re-run on a clean tree after probe removal; no sync-snapshot flake)
npm run build            -> next build succeeded (23/23 static pages, compiled + TypeScript finished)
```

The test count grew 716 → 728: the 12 new tests are the review-regression block plus the
paste-in routing block (`tests/unit/clipboard.test.ts` now has 43 tests; `npx vitest run
tests/unit/clipboard.test.ts` → 43 passed).

### Per-finding status

| # | Round-1 severity | Status | Evidence |
|---|---|---|---|
| 1 | BLOCKER | **FIXED** | live-shaped `[empty h1, "Body"]`, `target:'notion'` → `html: "<p>Body</p>"`, `text` frontmatter + `Body`; no `<h1></h1>`. Selection (`wholePage:false`) → `<p>Body</p>`; `obsidian` target → `html === ""`. `buildClipboardPayload` strips once (`clipboard.ts:109`) and `serializeObsidianBody`'s internal strip is idempotent. |
| 2 | MAJOR | **FIXED** (top-level tables) | Two-column `Page`/`Note` table whose cell is `[[Beta\|the beta]]` → body keeps `[[Beta\|the beta]]`; `engine.parse(body)` deep-equals the doc; idempotence holds. Residual blockquoted tables → N3. |
| 3 | MAJOR | **ACCEPTED-BY-SPEC** | Spec §6.2.1 now records the intentional ⌘C = Obsidian-only trade-off and §4.1 words AC1 around the explicit "Copy for Notion (rich)" action. Consequence (Docs/Word/email ⌘C becomes plain markdown) is stated. Legitimate amendment. |
| 4 | MAJOR | **ACCEPTED-BY-SPEC** (nit) | Spec §7 now says the `.html`/`.clipboard.json` files are serializer-generated golden anchors and points the real-app dogfood at SIL-68/SIL-70. Residual: the in-repo test names still call them "committed … capture" (`clipboard.test.ts:303,311`), the fixture files still carry no `source`/`recordedAt`, and the external dogfood cannot be verified here (GitHub #68/#70 are unrelated tickets; "SIL-*" are not GitHub issues). |
| 5 | MINOR | **ACCEPTED-BY-SPEC** (nit) | §5 table now promises `<mark>…</mark>` on the plain side, with a test asserting both sides emit `<mark>`. I independently confirmed `<mark>` and `<u>` are IR-identity when parsed from their own form. N6: neither is in `CORPUS` despite §5. |
| 6 | MINOR | **FIXED** | `` `arr[[i]]` `` untouched; `` `\[\[Page\]\]` `` inside a code span untouched; fenced code with `arr[[i]]` / `[[Page]]` untouched and re-parses to identity; a tilde fence is handled (serializer normalizes it and content survives); unterminated fence returns input unchanged, no throw. |
| 7 | MINOR | **PARTIAL** | Properties half works: shallow client merge matches the server's jsonb `||` RPC (`merge_page_properties`), so the next ⌘C emits post-paste properties. Tags half is self-defeating → N2. |
| 8 | MINOR | **FIXED** | rich `write` rejects → `writeText(payload.text)` called once, returns `true`; `ClipboardItem === undefined` → `writeText` only, `write` never called; both reject → `false`; no `navigator.clipboard` → `false`; plain-only payload → `writeText` only. |
| 9 | MINOR | **PARTIAL** | `javascript:`, `JavaScript:`, ` javascript:`, `data:text/html,…`, `vbscript:` → `''`; `https:`, `mailto:`, `obsidian:`, `/page/abc`, `#anchor`, `data:image/png` kept. Attribute breakout is impossible (`" onmouseover="` is escaped to `&quot;`). Residual: control-character scheme obfuscation passes → N1. |
| 10 | MINOR | **NOT FIXED** (not claimed) | Still no copy-event smoke test (`grep tests` finds no dispatched `copy` event; the three `ClipboardEvent` hits are `writeClipboardPayload` casts). Non-blocking, spec §9 says "where feasible". |
| 11 | NIT | **PARTIAL** | `role="separator"` added (`:1116`); both `!editor` paths now `setIsExportOpen(false)` (`:259`, `:301`); copy items get `disabled={isExporting}`. But `handleCopyFor` never sets `isExporting`, so the guard is inert during a copy → N5. |
| 12 | NIT | **FIXED** | `title: '   '` / `''` → no `title:` key and no frontmatter fence; non-empty titles still emitted (`engine.ts:35`). |
| 13 | NIT | **FIXED** | One import: `import { markdownEngine, stripAutoHeading, type PageMeta } from '@/lib/markdown/engine'` (`markdown-export.ts:5`). |
| 14 | NIT | **NOT FIXED** (not claimed) | The unreachable "leaked inline nodes" test remains; no partial-table / partial-list selection cases added. |
| 15 | NIT | **ACCEPTED-BY-SPEC** | §7/§9 now say "table-driven property test" and call out combinations; the two historically-broken combinations are in `CORPUS` and the idempotence/round-trip loops. Acceptable (not a generated fast-check property). |

### AC2 ("paste-out → paste-in is IR-identity") is now exercised through S1's real routing

`tests/unit/clipboard.test.ts:336-406` runs every `CORPUS` entry through
`buildClipboardPayload → classifyClipboardPaste(payload.text, undefined) === 'obsidian-markdown' →
splitObsidianFrontmatter → parser` (i.e. the same three seams the paste handler uses) and asserts IR
identity for whole-page, notion-target, and selection copies. `CORPUS` now contains both combinations
that previously slipped through (`:29` table + alias wikilink, `:30`/`:31` bracketed inline and fenced
code). I reproduced all four critical rows independently: each routes as `obsidian-markdown` and is
identity-true. This acceptance criterion is now backed by the right test.

### New / residual findings from the remediation

#### N1. MINOR (security, defense-in-depth) — `sanitizeUrl` can be bypassed with a tab/newline in the scheme

**Where:** `lib/markdown/notion-html.ts:46-52`.

`HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i` sees `java\tscript:` as "no scheme" and returns it verbatim;
the URL standard strips ASCII tab/CR/LF before scheme parsing, so a receiving app resolves it as
`javascript:`.

Repro (verified):

```
sanitizeUrl('java\tscript:alert(1)', 'link')  -> 'java\tscript:alert(1)'
serializeNotionHtml(doc with that link)       -> '<a href="java\tscript:alert(1)">click</a>'
sanitizeUrl('java\nscript:alert(1)', 'link')  -> 'java\nscript:alert(1)'
```

Reachability: the markdown import/paste route is safe — markdown-it percent-encodes the tab
(`[x](<java\tscript:…>)` yields href `java%09script:…`, which is not a scheme). The exposure is the
same one #9 described: a mark attribute hydrated from collab/doc JSON (no re-validation). Severity is
MINOR because the receiving app must preserve the href.

**Minimal fix:** normalize before the scheme test (and return the normalized value):

```ts
const raw = String(value).replace(/[\t\n\r]/g, '').trim()
```

Then `java\tscript:` normalizes to `javascript:` and is dropped.

#### N2. MINOR — the post-paste tag refresh overwrites the correct optimistic tags with pre-paste rows

**Where:** `components/editor-workspace.tsx:736-748` (`fetchPageTags(pageId)` inside the
`updatePageProperties(...).then`), against `server/index.js:174` and `server/persister.js:58`.

Ordering on a paste that carries frontmatter tags:

1. `updatePageProperties` resolves; the ref's `properties` (and `tags`, derived from
   `properties.tags`) are set to the merged post-paste values — correct.
2. `fetchPageTags(pageId)` is fired **immediately, before `applyBody()`**.
3. `page_tags` is only rewritten by `graphIndex.indexPage` inside the persister, which runs after the
   **2 s idle debounce** (`server/index.js:174`, `scheduleDebouncedSave`). The RPC
   `merge_page_properties` does not touch `page_tags`.
4. The fetch therefore returns the pre-paste rows and the `.then` assigns them, clobbering the
   correct value; nothing ever re-refreshes the ref, so the session stays stale for the *next* ⌘C too.

Net user-visible result: properties are fresh, `tags:` in frontmatter is stale — the same outcome as
before the fix, but the fix now actively reverts a correct value. Secondary race: the mount effect
(`:192-197`) has no generation guard, so a slow `fetchPageDetails` that resolves after a fast paste
would also overwrite the merged properties.

**Minimal fix:** drop the immediate `fetchPageTags` (the optimistic `tags` already come from the same
merged property set), or move it after the debounced save/`onSynced` with a request-generation guard.
Do not keep both an optimistic write and an unguarded stale fetch.

#### N3. MINOR (residual #2) — an aliased wikilink in a **blockquoted** table still splits the cell

**Where:** `lib/markdown/engine.ts:108` (`TABLE_ROW_RE = /^\s*\|/`) with `:148`.

Repro (verified):

```
parse('> | Page | Note |\n> | --- | --- |\n> | [[Beta\\|the beta]] | x |\n')
serializeObsidianBody -> '> | Page | Note |\n> | --- | --- |\n> | [[Beta|the beta]] | x |\n'
parse(body)           -> row has 3 cells  (IR identity false)
```

A table inside a blockquote is schema-legal and round-trips through the parser, so this is reachable.
Same failure as the round-1 #2, now confined to prefixed rows (top-level, list-item and plain
paragraph cases are correct — list-item tables keep the escape and are identity-true).

**Minimal fix:** strip blockquote/list prefixes before the table probe, e.g.
`const row = line.replace(/^(?:\s*>\s*)+/, '')` then `TABLE_ROW_RE.test(row)`.

#### N4. NIT — fence tracking compares only the marker character, not the fence length

**Where:** `lib/markdown/engine.ts:104, 133-144` (`const marker = fenceMatch[1][0]`).

Repro (verified): `restoreWikilinks('````md\n```\n\\[\\[W\\]\\]\n```\n````')` restores the escaped
wikilink **inside** the fence (the inner 3-backtick line is treated as the closer), mutating code.
Not reachable from the shipping path today (the serializer never emits 4+ backtick fences; a code
block containing ``` produces already-broken output), but `restoreWikilinks` is exported and its
docstring promises "copied verbatim".

**Minimal fix:** keep the full opener run and close only on the same character with
`run.length >= opener.length`.

#### N5. NIT — copy menu items are disabled by a flag the copy path never sets

**Where:** `components/editor-workspace.tsx:1129` (`disabled={isExporting}`) vs `:297-321`
(`handleCopyFor` never calls `setIsExporting`).

The round-1 nit ("a double click can run two clipboard writes") is therefore not actually closed;
the items only disable while an *export* runs. This nit was reworded as fixed in the commit message.
**Minimal fix:** `setIsExporting(true)` at the top of `handleCopyFor` (the `finally` already resets
it and closes the menu).

#### N6. NIT — `CORPUS` still omits highlight and underline

**Where:** `tests/unit/clipboard.test.ts:19-37` vs spec §5 ("Paragraph + marks" row).

Both are IR-identity when parsed from their own form (verified: `<mark>` and `<u>` both return
identity true), so this is only corpus completeness for AC2's "every construct in the suite" claim.
Add `{ name: 'highlight', markdown: 'plain <mark>marked</mark> text\n' }` and the `<u>` equivalent.

### Verified as correct (no new finding)

- The double strip in `buildClipboardPayload` + `serializeObsidianBody` is genuinely idempotent and
  does not change selection/obsidian payloads (byte-compared against round-1 expectations).
- Prose/heading/list/callout aliases still restore to the unescaped `[[Beta|the beta]]`; the table
  escape is scoped to `|`-leading rows only.
- `CODE_SPAN_RE`'s module-level `/g` state is reset per line and `String.replace` with a `/g` regex
  resets `lastIndex`, so the shared-regex approach is safe for the synchronous call path.
- `stripAutoHeading` still keeps non-empty authored headings and an empty trailing heading rule is
  unchanged; the Notion walker receives the same doc as the markdown writer.
- `copyClipboardPayloadToSystem` never throws, keeps `writeText` as the single fallback, and keeps
  plain-only payloads on `writeText` (the SIL-68 behaviour is intact).
- Client-side properties merge semantics match the server RPC exactly (`coalesce(properties,'{}') ||
  patch`, top-level), so no phantom-key divergence.
- Scope is still clean: no `lib/markdown-io.ts`, no sync wording, no unrelated files; the review file
  added by this commit is the round-1 document itself.

### Remaining open items (unchanged, non-blocking)

- #10 (no copy-event jsdom test) and #14 (unreachable leaked-inline test / no partial-table or
  partial-list selection case) were explicitly not addressed. Both are MINOR/NIT and can ship as
  follow-ups; #14's fabricated doc is still dead code in the test suite.
- #4's in-repo naming still overstates the fixtures as captures; #5/#15's corpus gap is N6.

### Final verdict rationale

The round-1 BLOCKER (#1) and MAJOR behaviour defect (#2) are fixed and verified with independent
reproductions; the product/spec conflicts (#3, #4, #5, #15) are resolved by recorded spec amendments
rather than silent drift. The remaining problems are three MINORs and three NITs — incomplete
defense-in-depth (#9/N1), an ineffective half of the metadata refresh (#7/N2), a prefixed-row table
residual (#2/N3), plus cosmetic/test-hygiene items. None of them blocks the primary copy-out /
paste-in path or the acceptance criteria as amended.

VERDICT: APPROVE
