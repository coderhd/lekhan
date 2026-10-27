# Clean-room review — SIL-58 / #78 S2 Notion import (zip route)

**Branch:** `feat/58-notion-import-zip` (base `origin/main` @ 9954aaf)
**Reviewer:** independent clean-room reviewer subagent (fresh context, read-only)
**Cycles:** 4 (REQUEST CHANGES → REQUEST CHANGES → REQUEST CHANGES → APPROVE), plus one
post-approval pass for the automated review on PR #151 and one fix from the QA gate (SIL-100).

## Verdict

**APPROVE** after four cycles; the QA gate's single blocking finding (B1, callout over-conversion)
was fixed and regression-covered afterwards. Targeted Notion/dialog tests, the full suite,
typecheck, lint and production build are green. No blocking or high findings remain.

## Findings raised and resolved

### Cycle 1

| Sev | Finding | Resolution |
|---|---|---|
| BLOCKING | Notion import never starts in a real browser: `e.target.value = ''` empties the live `FileList` before `handleNotionFiles` reads it. Tests used a plain array so they could not catch it. | Snapshot `Array.from(e.target.files)` **before** resetting the input (Notion + webkitdirectory fallback). Regression test emulates the browser mutating the same list object. |
| HIGH | Row↔page matching only handled one exact folder layout; sibling/nested CSV layouts duplicated rows (one with body, one with properties) and leaked a `Private & Shared` folder page. | Wrapper-only CSV dirs resolve to the database title; row matching accepts database-title / nested-database folders; committed `database-layouts.zip` fixture covers sibling + nested sibling. |
| HIGH | Link/image rewriting ran inside fenced code, corrupting code samples and inflating `attachmentsDropped`. | Fence- and inline-code-aware transforms (see cycle 3 for the fence-run refinement). |
| MEDIUM | Titles containing `\|` produced dangling `[[B\|alias]]` links but reported them resolved. | Unrepresentable titles keep visible text and count a degraded block. |
| MEDIUM | Safety envelope reset per multi-part zip; bomb guard depended on a private JSZip field without failing closed. | One byte/image budget shared across parts; fail closed when the uncompressed size is unavailable. |
| MEDIUM | `parseCsv` treated a stray mid-cell quote as an unterminated field and swallowed the rest of the file. | A quote opens a field only at cell start; test added. |
| NIT | Report wording contradicted Notion behaviour; empty export misreported as non-Notion; executable schemes passed through. | Wording neutralised; empty export has its own message; `javascript:`/`vbscript:`/`data:`/`file:` links drop to text; tests added. |

### Cycle 2

| Sev | Finding | Resolution |
|---|---|---|
| MEDIUM | Per-line inline-code splitting destroyed link labels containing code and multi-line `<img>` tags. | `transformOutsideFences` now transforms whole fence-free blocks; `replaceOutsideInlineCode` skips matches whose offset falls inside an inline-code span. |
| MEDIUM | `[` in a linked title still emitted an unmatchable wikilink reported as resolved. | `toWikilink` rejects `\|`, `[` and `]` in targets; alias strips formatting chars so the link stays a single text node. |
| MEDIUM | A normal page beside a nested CSV (`Product/Overview.md` + `Product/Tasks.csv`) was consumed as a row and had its frontmatter overwritten. | `db.folder` only counts as a row location when it equals the database title; CSV-only rows synthesize into the nested database folder. Test added. |

### Cycle 3

| Sev | Finding | Resolution |
|---|---|---|
| MEDIUM | Fence tracking ignored fence character/run length, so a nested shorter fence ended a longer code block and rewriting resumed inside code. | Openers record char + run length; only a same-char run ≥ opener (whole line) closes. 4-backtick/3-backtick test added. |
| MEDIUM | Link labels containing `]` (`[Array[0] notes](…)`) never matched, so the destination vanished unreported. | Label regex accepts one nesting level; bracket characters are removed from the alias and the change is counted as a degraded block. Test added. |
| NIT | Mirror bug for image alt text containing brackets. | Same nested-label rule applied to `MARKDOWN_IMAGE_RE`; test asserts alt text survives and the drop is counted. |

### Cycle 5 — post-approval review on PR #151

Automated reviewers (pullfrog + CodeRabbit) reviewed the opened PR. Three nits and five
correctness items were verified against the branch and addressed:

| Sev | Finding | Resolution |
|---|---|---|
| MAJOR | CSVs were grouped by cleaned folder, so two sibling databases in one folder collapsed into one: the other database's rows vanished while its views still counted as deferred. | Group by database identity (Notion id, else cleaned title) + folder; the map is keyed by the selected primary CSV path. Committed `sibling-databases.zip` fixture + regression test (two sibling databases, `_all.csv` preference, CSV-only row). |
| MEDIUM | Link/image/bare-URL destinations were matched by regex, so a raw `)` (`Notes (Q3) <id>.md`) truncated the target and lost the trailing id. | Regexes replaced by a balanced-destination scanner (`readMarkdownLabel`, `readMarkdownDestination`, `replaceMarkdownTargets`); optional titles, `<...>` targets, escapes and nested labels are handled. Tests cover raw, nested and percent-encoded parentheses for links, images and bare Notion URLs. |
| MEDIUM | Id extraction for relative links matched the first 32-hex run in the raw URL: `%20` glued onto the target id and a folder id could win over the page id. | Extract the id from the decoded **last** path segment; folder ids are ignored and `%20<id>` decodes to ` <id>` before matching. |
| MINOR | The empty-export/page-limit guard ran after body processing and Yjs conversion for every page. | Guard moved directly after `sortedDirs`, using `rawPages.length` + `sortedDirs.length`; a spy test proves no page body is converted when the export is over the limit. |
| NIT | Unreachable `mailto:` guard; duplicated `_all` replace; dead `calloutsConverted` counter. | Removed. Callout conversion is lossless, so it is not a degradation and does not belong in the report. |
| NIT | Two Markdown tables had an unescaped `\|`. | Escaped. |

### Cycle 6 — QA gate B1 (callout over-conversion)

The QA Engineer's fixture/dogfood gate (`docs/reviews/pr-58-qa.md`, SIL-100) found one blocking
bug: `CALLOUT_TABLE_RE`'s lazy captures backtracked across cell/row boundaries, so a 3-cell row
or a multi-row table could convert into a callout and lose the remaining cells.

| Sev | Finding | Resolution |
|---|---|---|
| BLOCKING | A `<table>` with 3+ cells or 2+ rows collapsed into a callout body: cells silently dropped (`icon="x"`, `content="y</td><td>z"`). | A match is rejected when either capture contains a `<td>`/`<tr>`/`<table>` tag, so only Notion's genuine one-row/two-cell shape converts; every other table is returned whole and counted in `degradedBlocks`. New `html-tables.zip` fixture + test (callout converts once, all seven table cells survive, two `<table>` elements remain). |


### Cycle 7 — external review after the QA fix

| Sev | Finding | Resolution |
|---|---|---|
| MAJOR | Notion's Markdown & CSV export can render callouts as `<aside>💡 text</aside>`; only the table form converted. | `unwrapCallouts` now converts `<aside>` callouts too (leading pictograph → callout type, body preserved). `<aside>` joins the leftover-HTML counter when it cannot convert. `html-tables.zip` covers both forms. |
| MINOR | A `[[Title\|alias]]` emitted inside a pipe-table row was split across cells by GFM. | After link rewriting, wikilink pipes in table rows are escaped as `\|` outside code; a regression test asserts two cells and the intact `[[Other\|the other]]` text. |
| NIT | Duplicate phrase in the QA record; unescaped `\|` in a review table; JSDoc glued to `toWikilink`. | Fixed. |

## Verification evidence

```
npm run typecheck   # clean
npm run lint        # clean
npm test            # 87 files / 735 tests passed
npm run build       # Next.js production build succeeded
```

Targeted suites: `notion-import-read` (11), `notion-import` (30), `notion-import-identity` (4),
`import-dialog` (12).

## Accepted limitations / follow-ups

- **Real-export dogfood is the QA gate.** Committed fixtures are structurally faithful captures of
  Notion's documented Markdown & CSV layout (no third-party data). QA must review the fixture suite
  and dogfood an actual Notion export before approving the PR.
- **Graph shape is verified by the unchanged server path.** This branch tests importer → IR →
  writer payload; `/api/import`'s page inserts + `sync_page_graph` are covered by the existing
  `api-import` / `graph-index` suites and are not modified.
- **Indented (4-space) code blocks** are not protected from rewriting. Notion emits fenced code;
  noted as low risk.
- `toWikilink` alias sanitisation removes formatting characters (backticks/brackets) from a label
  to keep the link matchable; bracket removal is reported, backtick formatting removal is not.
