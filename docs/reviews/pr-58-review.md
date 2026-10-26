# Clean-room review — SIL-58 / #78 S2 Notion import (zip route)

**Branch:** `feat/58-notion-import-zip` (base `origin/main` @ 9954aaf)
**Reviewer:** independent clean-room reviewer subagent (fresh context, read-only)
**Cycles:** 4 (REQUEST CHANGES → REQUEST CHANGES → REQUEST CHANGES → APPROVE)

## Verdict

**APPROVE** after four cycles. 51 targeted Notion/dialog tests, 729 full-suite tests, typecheck,
lint and production build are green. No blocking or high findings remain.

## Findings raised and resolved

### Cycle 1

| Sev | Finding | Resolution |
|---|---|---|
| BLOCKING | Notion import never starts in a real browser: `e.target.value = ''` empties the live `FileList` before `handleNotionFiles` reads it. Tests used a plain array so they could not catch it. | Snapshot `Array.from(e.target.files)` **before** resetting the input (Notion + webkitdirectory fallback). Regression test emulates the browser mutating the same list object. |
| HIGH | Row↔page matching only handled one exact folder layout; sibling/nested CSV layouts duplicated rows (one with body, one with properties) and leaked a `Private & Shared` folder page. | Wrapper-only CSV dirs resolve to the database title; row matching accepts database-title / nested-database folders; committed `database-layouts.zip` fixture covers sibling + nested sibling. |
| HIGH | Link/image rewriting ran inside fenced code, corrupting code samples and inflating `attachmentsDropped`. | Fence- and inline-code-aware transforms (see cycle 3 for the fence-run refinement). |
| MEDIUM | Titles containing `\|` produced dangling `[[B|alias]]` links but reported them resolved. | Unrepresentable titles keep visible text and count a degraded block. |
| MEDIUM | Safety envelope reset per multi-part zip; bomb guard depended on a private JSZip field without failing closed. | One byte/image budget shared across parts; fail closed when the uncompressed size is unavailable. |
| MEDIUM | `parseCsv` treated a stray mid-cell quote as an unterminated field and swallowed the rest of the file. | A quote opens a field only at cell start; test added. |
| NIT | Report wording contradicted Notion behaviour; empty export misreported as non-Notion; executable schemes passed through. | Wording neutralised; empty export has its own message; `javascript:`/`vbscript:`/`data:`/`file:` links drop to text; tests added. |

### Cycle 2

| Sev | Finding | Resolution |
|---|---|---|
| MEDIUM | Per-line inline-code splitting destroyed link labels containing code and multi-line `<img>` tags. | `transformOutsideFences` now transforms whole fence-free blocks; `replaceOutsideInlineCode` skips matches whose offset falls inside an inline-code span. |
| MEDIUM | `[` in a linked title still emitted an unmatchable wikilink reported as resolved. | `toWikilink` rejects `|`, `[` and `]` in targets; alias strips formatting chars so the link stays a single text node. |
| MEDIUM | A normal page beside a nested CSV (`Product/Overview.md` + `Product/Tasks.csv`) was consumed as a row and had its frontmatter overwritten. | `db.folder` only counts as a row location when it equals the database title; CSV-only rows synthesize into the nested database folder. Test added. |

### Cycle 3

| Sev | Finding | Resolution |
|---|---|---|
| MEDIUM | Fence tracking ignored fence character/run length, so a nested shorter fence ended a longer code block and rewriting resumed inside code. | Openers record char + run length; only a same-char run ≥ opener (whole line) closes. 4-backtick/3-backtick test added. |
| MEDIUM | Link labels containing `]` (`[Array[0] notes](…)`) never matched, so the destination vanished unreported. | Label regex accepts one nesting level; bracket characters are removed from the alias and the change is counted as a degraded block. Test added. |
| NIT | Mirror bug for image alt text containing brackets. | Same nested-label rule applied to `MARKDOWN_IMAGE_RE`; test asserts alt text survives and the drop is counted. |

## Verification evidence

```
npm run typecheck   # clean
npm run lint        # clean
npm test            # 87 files / 729 tests passed
npm run build       # Next.js production build succeeded
```

Targeted suites: `notion-import-read` (11), `notion-import` (24), `notion-import-identity` (4),
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
