# #58 / SIL-58 — Notion import (zip route): native export → ImportIR → graph

**Status:** spec (Stage 1 — DEFINE) + design (Stage 2 — PLAN)
**Issue:** SIL-58 · epic SIL-9 / coderhd/lekhan#78 · accepted plan rev 1 §3-S2
**Owner:** Dev Engineer · QA verification + real-export dogfood before REVIEW
**Scope lock:** Notion **Markdown & CSV** native export zip → source-agnostic `ImportIR` → the
existing `/api/import` write path. No live sync, no API route (S7), no view/formula recreation.

## Problem (restated)

Notion's **Export → Markdown & CSV** produces a zip that is hostile to a naive Markdown import:

- every page and folder filename ends in a 32-hex page/block id (`Roadmap 2f1c… .md`);
- internal links are UUID-bearing relative paths, sometimes with punctuation that Notion stripped
  from the filename, and relation cells often use `https://www.notion.so/Title-<32hex>` URLs;
- databases flatten to one CSV per exported view, while rows are also Markdown pages;
- images live in UUID-suffixed attachment folders and links break when that folder is renamed;
- callouts are exported as HTML tables; synced blocks/comments/formulas/rollups/attachments are
  flattened or omitted with no marker in the file.

The existing pipeline (`services/obsidian-import.ts` → `services/vault-import.ts` →
`app/api/import/route.ts` → `sync_page_graph`) already solves the write side: batching, folder
chains, encrypted Yjs snapshots, graph indexing, and #87 idempotent retry. S2 must feed it from a
Notion producer instead of forking a second writer.

## Acceptance criteria (from the issue)

- [ ] **AC1** Committed Notion export-zip fixtures (including a multi-part case) round-trip through
      importer → IR → graph shape with expected page counts, link resolution, and report contents.
- [ ] **AC2** Database rows arrive as Pages carrying their CSV columns as Page properties
      (zip-fidelity-limited; API route S7 gets full typed fidelity).
- [ ] **AC3** IR-identity property tests: import → serialize → reimport preserves suite constructs.
- [ ] **AC4** First artifact (DEFINE) is this spec.
- [ ] **AC5** Report names, honestly and visibly: database views deferred to Lekhan databases
      (H2 #47), synced blocks, comments, formulas/rollups flattened to static text, non-image
      attachments dropped.
- [ ] **AC6** Zero Notion API calls / rate-limit exposure: every byte is parsed client-side from the
      user-supplied zip.
- [ ] **AC7** Internal links with baked-in IDs resolve by UUID → title/page mapping where possible;
      unresolvable links remain **visible unresolved Page links** (`[[Title]]`).
- [ ] **AC8** UX sets expectations: Notion's export queue can take hours for large workspaces,
      exports may arrive in multiple zips, and download links expire after 7 days.

## Design

### D1 — Generalize the IR; do not fork the writer

New `services/import-ir.ts` holds the source-agnostic contract:

```ts
type ImportSourceKind = 'obsidian' | 'notion'

interface ImportPageProvenance {
  source: ImportSourceKind
  sourcePath: string          // path inside the source archive
  blockId?: string            // 32-hex Notion page/block id, when encoded
  database?: {                // present for a database row
    title: string
    csvPath: string
    titleColumn: string
  }
}

interface ImportPage { title; folderPath; properties; tags; contentYjsBase64;
                       plainText; isFolder; contentHash?; provenance? }

interface ImportIR { workspaceId: string; source: ImportSourceKind; pages: ImportPage[] }

interface ImportReport { pages; folderPages; linksResolved; linksUnresolved;
                         degradedBlocks; degradations?: ImportDegradation[] }
```

`ObsidianImportPage`/`ObsidianImportIR` remain exported aliases so #27 callers keep working.
`services/vault-import.ts` accepts `ImportIR` unchanged (it already only reads page fields), and its
fingerprint prefixes `ir.source` so an Obsidian and a Notion import with coincidentally equal pages
never share a retry id. Provenance never reaches the server as meaningful state — `/api/import`
ignores unknown page fields — but it is kept on the IR for the report, tests, and future producers.

**Extend, not fork:** no second batcher, no second `/api/import`, no second snapshot/encryption path.

### D2 — Zip reader (client-side, bounded)

`services/notion-import.ts`:

- `readNotionZip(file)` / `readNotionZips(files)` load with JSZip and return
  `{ files: { path, data }[], directories: string[], parts: number, duplicatePagesSkipped: number }`.
- Accept `.md`, `.markdown`, `.csv`, images. Skip `__MACOSX/`, `.DS_Store`, hidden entries.
- Reuse the vault reader's safety envelope: 10 MB/file, 100 MB total, 1,000 images, 2,000 pages.
- Multi-part: read each selected zip, merge entries. Two entries with the same extracted Notion
  UUID are the same page (Notion can export a nested page twice); keep the first and count the
  duplicate. Identical raw paths are also deduped.
- Verify it looks like a Notion export (UUID-suffixed filename or a database CSV). An Obsidian zip
  dropped into this path fails with an actionable error rather than importing garbage.

### D3 — Page extraction

- Clean names: strip a trailing ` [0-9a-f]{32}` and the extension, per path segment. Strip known
  export wrappers (`Private & Shared`, `Export-<uuid>`).
- `title` = cleaned filename; `folderPath` = cleaned ancestor path. Every ancestor of a
  page (and every database folder, even an empty one) becomes a folder page, the same contract as
  the Obsidian importer. Attachment-only directories (e.g. `<Page>/diagrams/`) are *not* pages —
  Notion uses them to hold files, not content — while their images are still resolvable by raw path.
- Notion writes the page title as a leading H1 in most exports. If that H1 equals the cleaned title,
  drop it before parsing so the page title is not duplicated; the existing `fitLiveSchema` prepends
  the usual empty H1. A different leading heading is preserved as content.
- Parse the body with `markdownEngine.parse` (the live schema), seed with
  `markdownEngine.seedToYjsBase64`, and compute `contentHash` exactly like #27 so #87 retry
  semantics are inherited.

### D4 — Databases (CSV → row Pages)

- Every `.csv` in the archive is a database export. Prefer `<stem>_all.csv` when several CSVs share
  a folder (other CSVs are exported views; they count toward deferred views, they do not duplicate
  rows).
- RFC-4180 parser: quoted commas, escaped quotes, embedded newlines, CRLF, BOM.
- Database title = cleaned CSV basename (`_all` stripped). Row folder = cleaned CSV directory, or the
  database title if the CSV sits at the root.
- Title column = first CSV column (Notion's title property is exported first). Page title = that
  cell (`Untitled` when blank).
- **Properties = every CSV column**, values kept as strings (empty string when blank). The title
  column is retained as a property too: that is the literal zip fidelity we can promise. Typed
  fidelity arrives with S7.
- A row's Markdown page (same cleaned title inside the database folder, including one nested
  folder level) supplies the body; its provenance gains `database`. A row with no Markdown page
  becomes an empty-body page, so no row is silently lost.
- Views are not recreated: report `databaseViewsDeferred = number of CSVs`
  (`"N database views deferred to Lekhan databases (H2 #47)"`).

### D5 — Link, image, callout, and degradation handling

- **Links:** rewrite Markdown links whose target is a relative path or a `notion.so` URL.
  Extract the 32-hex id and resolve it against the page/row registry (UUID → cleaned title).
  Fall back to a cleaned path/title match. Resolved → `[[Title]]` or `[[Title|text]]`; unresolved →
  a visible unresolved link `[[CleanedTarget|text]]` and `linksUnresolved++`. External URLs are
  untouched. Link targets are resolved against the **raw** archive paths (before name cleaning),
  because Notion's link text and filename punctuation differ.
- **Images:** resolve `![alt](path)` (and `<img src>`) against the raw note directory, then archive
  root, then a unique basename. Resolved → base64 data URL (same MIME table as #27). Missing image
  or non-image attachment → replace with the visible alt/text (never a dead link) and count
  `attachmentsDropped`.
- **Callouts:** Notion exports callouts as a one-row/two-cell HTML table (icon + text). Convert to
  the Obsidian callout dialect (`> [!note]`) so the existing parser keeps the callout node; other
  raw HTML is left to the parser and, if it cannot be represented, counted in `degradedBlocks`.
- **Synced blocks:** strip `<!-- synced_block … -->` markers, keep the content static, and report
  `syncedBlocksFlattened`. The report names the synced-block category even when none are detected
  (Notion's Markdown export cannot preserve the live link). Comments and formulas/rollups are
  always named in the report because a Markdown & CSV export cannot carry them.

### D6 — Honest report

`NotionImportReport extends ImportReport` adds `source: 'notion'`, `databaseViewsDeferred`,
`databaseRows`, `syncedBlocksFlattened`, `commentsOmitted`, `formulasRollupsFlattened`,
`attachmentsDropped`, `exportParts`, `duplicatePagesSkipped`, and a normalized
`degradations[]` list. `ImportReportCard` renders those lines verbatim; nothing disappears silently.
Marketing/copy constraint: **compatibility, never live sync** — no copy may imply ongoing sync.

### D7 — UX

- New chooser option **“Notion export (.zip)”** with multi-file selection.
- Copy states: Notion must finish its export queue first (hours for large workspaces); exports can
  be split into multiple zips (select them together); download links expire after 7 days; parsing
  happens entirely on the device and calls no Notion API.
- Same phase machine (`picking → ingesting → writing → done/error`), same retry semantics, same
  report card. Analytics `import_completed` uses `source: 'notion'`.

### D8 — Out of scope (named, not expanded)

Live sync; Notion API import (S7); view/filter/sort grouping recreation; formula/rollup evaluation;
synced-block recreation; comments/permissions/embeds; Dataview execution; Notion **HTML** exports
(the zip route deliberately targets Markdown & CSV, the export format that preserves page bodies as
Markdown). HTML export dropped into this path gets an actionable error naming Markdown & CSV.

## Edge cases

| Edge | Behaviour |
|---|---|
| Obsidian zip picked as Notion | Reject: "This doesn't look like a Notion export…" — no partial writes |
| HTML export picked | Reject with the Markdown & CSV instruction |
| Empty zip / no pages | Reject: nothing to import |
| Page title contains `/`, `#`, `?`, `*`, `|` | Kept in the Page title/properties; path segments are cleaned independently |
| Duplicate page UUID across multi-part zips | Keep first; report duplicate count |
| Database row without a Markdown page | Page created from CSV columns, empty body |
| Database row title blank | `Untitled`, columns still imported |
| CSV with quoted commas/newlines/BOM | Parsed by the RFC-4180 reader |
| Link target punctuation stripped by Notion | UUID match wins over filename match |
| Link with `#block-id` fragment | Page target resolved; fragment dropped (block refs are out of scope) |
| Broken/missing image | Visible alt text; counted as a dropped attachment |
| Non-image attachment link | Link text kept, target dropped; counted |
| Image larger than limit / archive over limits | Same bounded error as the vault reader |
| >2,000 pages | Reject with "split the export / import parts" guidance |
| Retry after a failed batch | Same `clientImportId` fingerprint path as #87; no duplicates |

## Test requirements

1. **Reader** (`tests/unit/notion-import-read.test.ts`): md/csv/image enumeration, wrappers/junk,
   limits, multi-part merge + UUID dedupe, non-Notion/HTML rejection.
2. **Importer** (`tests/unit/notion-import.test.ts`): committed fixtures — page/folder counts, clean
   titles, DB row pages + CSV properties, link resolution (UUID/path/notion.so), visible unresolved
   links, image data URLs, dropped attachments, callout conversion, synced markers, report lines,
   multi-part case, seeded editor renders constructs.
3. **IR identity** (`tests/unit/notion-import-identity.test.ts`): import → Yjs → Markdown →
   reimport preserves headings, lists, tasks, tables, code, callouts, wikilinks and is idempotent
   across a generated matrix of constructs; Notion IR fingerprint is stable across identical ingestions.
4. **Dialog** (`tests/unit/import-dialog.test.tsx`): Notion option + expectations copy, multi-file
   pick, report degradations rendered, `source: 'notion'` analytics, retry reuses the id.
5. **VERIFY:** `npm run typecheck && npm run lint && npm test && npm run build`.
6. **QA gate:** QA Engineer reviews the fixture suite and dogfoods a **real** Notion export before
   REVIEW. The committed fixtures are structurally faithful captures of the documented export
   layout (no third-party personal data); real-export fidelity is the QA gate's job.

## Fixtures

`tests/fixtures/notion/`:

- `basic-export.zip` — Markdown & CSV workspace export: two nested page trees, UUID-suffixed files
  and folders, a database folder with `_all.csv` + row pages (including a CSV-only row), a resolved
  relative link, a `notion.so` UUID link, an unresolved link, an image, a broken image, a non-image
  attachment, an HTML callout, a synced-block marker, and `__MACOSX`/`.DS_Store` junk.
- `multi-part/part-1.zip`, `part-2.zip` — a split export with disjoint pages plus one duplicate page
  UUID to exercise merge + dedupe.
