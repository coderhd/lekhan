# SIL-60 / S4 — Workspace → Obsidian vault zip export (client-side) + symmetric FidelityReport

**Stage 1 (DEFINE) spec** · Owner: Dev Engineer · Epic: SIL-9 (#78 H1 Dual-Dialect Interop Bridge) · Plan: §3-S4
**Branch:** `feat/60-vault-export` (stacked on `feat/59-clipboard-copy` @ 76820b0, which carries S3's engine Obsidian profile) · Status: building beyond DEFINE in the same issue

## 1. Problem

Single-Page export exists (`serializeExport` / `lib/markdown-export.ts`): one Page → one `.md`/`.html`
download. There is **no whole-Workspace export**, and no production zip *writer* — JSZip is only ever
`loadAsync`'d in import code/tests (plan §1 gap 3). A user leaving Lekhan cannot take their graph with
them in a shape Obsidian opens cleanly, and export reports nothing about what degraded.

## 2. Scope (plan §3-S4; stories 11–13, 26)

Add, fully **client-side** (no export endpoint, no server roundtrip — story 13):

1. **Vault-shaped zip.** Build a vault from the workspace Page graph:
   - folder tree mirrors `parent_id` nesting (a Page with children becomes `<page-slug>/…` for its
     children; folder-pages created by import contribute a directory but no note);
   - every non-folder Page serialized with S3's Obsidian profile
     (`markdownEngine.serializeObsidianPage` — frontmatter from Page properties + tags, callouts,
     `[[wikilinks]]`, inline `#tags`, native tables/code);
   - **attachment bundling**: base64 `data:` images in a Page doc are decoded, written once under an
     `attachments/` folder, and rewritten to vault-relative `![alt](attachments/<name>)` so they
     resolve in-vault instead of bloating every file with a data URI.
2. **Production zip writer** (`lib/zip-write.ts`) over `fflate` — a **new** create path (not the
   JSZip *read* path). Pure: files in → `Uint8Array` out; no `fetch`, no DOM, callable from a Worker.
3. **Symmetric FidelityReport** (`lib/fidelity-report.ts`): one `direction: 'import' | 'export'` shape
   replacing the import-only `ObsidianImportReport` at the UI layer, generalizing
   `components/import-report-card.tsx` into `components/fidelity-report-card.tsx`. Export rows name
   unresolved wikilinks, degraded/omitted blocks, and — where a Page carries database metadata —
   “database views deferred to Lekhan databases (H2 [#47](/SIL/issues/SIL-19))”.

## 3. Non-goals (plan §6, non-negotiable)

- **Compatibility, never live sync.** No export affordance may imply sync.
- Out of scope: live/continuous sync; Dataview/DQL execution (preserved inert); Canvas files; Notion
  push/import (S2/S5–S7).
- Targets `lib/markdown/engine.ts` / `lib/markdown-export.ts`; the `lib/markdown-io.ts` facade is
  already deleted (ADR 0005 / SIL-54).
- Attachment bundling covers images already in the Page doc (inline `data:` images, the shape the
  importer produces). Non-image file attachments are not silently invented — counted as omissions.

## 4. Acceptance criteria (restated)

1. Export of a nested multi-page workspace with attachments yields a zip that drops into a real
   Obsidian vault cleanly: folders mirror nesting, wikilinks resolve in-vault, and
   callouts/frontmatter/tags render natively — proven by unzip-and-assert tests against a committed
   vault fixture.
2. Zip build requires **no server roundtrip** (client-side guarantee) — the builder is a pure
   function; a test asserts it never calls `fetch`.
3. Export report is the **same component/shape** as the import report, with direction-specific rows.
4. First artifact is this spec.

## 5. Design

### 5.1 `lib/zip-write.ts` (seam: production zip writer)

```ts
export interface ZipEntry { path: string; data: Uint8Array | string }
export function buildZipBytes(entries: ZipEntry[]): Uint8Array   // fflate.zipSync, no I/O
export function zipBlob(entries: ZipEntry[]): Blob               // application/zip
```

Strings are UTF-8 encoded. Directory structure is implied by `path` (Obsidian creates folders from
file paths). Duplicate paths are rejected (never silently overwritten).

### 5.2 `lib/markdown/vault-export.ts` (seam 2: serializer + graph)

```ts
export interface VaultPage {
  id: string
  parentId: string | null
  title: string
  tags?: string[]
  properties?: Record<string, unknown>
  doc?: JSONContent           // undefined for folder pages / unloaded bodies
  isFolder?: boolean
}
export interface VaultExportFile { path: string; data: Uint8Array | string }

export interface VaultExportResult {
  files: VaultExportFile[]
  report: FidelityExportReport   // FidelityReport (direction 'export')
}

export function buildVaultFiles(pages: VaultPage[]): VaultExportResult
export function buildVaultZip(pages: VaultPage[]): { zip: Uint8Array; report: FidelityExportReport }
```

Rules:
- **Paths**: each Page's vault directory is the slugged title chain of its `parent_id` ancestors
  (`slugifyTitle` from `lib/markdown-export.ts`); the file is `<slug(title)>.md`, deduped per folder
  with a `-2`, `-3` suffix. Non-folder Pages always emit a note; folder Pages emit no note (their
  title only names a directory).
- **Content**: `markdownEngine.serializeObsidianPage(stripAutoHeading(doc), { title, tags, properties })`.
- **Attachments**: `data:<mime>;base64,…` image sources are decoded to bytes, hashed for a stable
  name `<base>.<ext>` (deduped), written under `attachments/`, and the image src is rewritten to the
  relative path before serialization.
- **Report**: `pages` (notes emitted), `folderPages`, `linksResolved`/`linksUnresolved` (distinct
  normalized `[[target]]`s vs the set of exported Page titles), `degradedBlocks` (image nodes whose
  data URI failed to decode, non-image embeds left as text), `omissions` (database views when a Page
  carries `properties.database`).

### 5.3 `lib/fidelity-report.ts` (seam: shared report shape)

```ts
export type FidelityDirection = 'import' | 'export'
export interface FidelityReport {
  direction: FidelityDirection
  pages: number
  folderPages: number
  linksResolved: number
  linksUnresolved: number
  degradedBlocks: number
  omissions: FidelityOmission[]
  warnings: FidelityWarning[]
}
export function fromImportReport(r: ObsidianImportReport): FidelityReport
```

### 5.4 `components/fidelity-report-card.tsx`

One card rendering both directions; direction-specific copy (import: “Import complete / N pages
created”; export: “Export complete / N pages written to your vault”). Preserves every existing
import `data-testid` (`import-report`, `report-pages`, `report-links`, `report-unresolved`,
`report-degraded`, `report-warnings`) so `tests/unit/import-dialog.test.tsx` keeps passing;
`components/import-report-card.tsx` becomes a thin adapter over it.

### 5.5 Content source — a DEFINE finding (carried to a child integration task)

The builder above is pure; it needs each Page's `doc` (Tiptap JSON). **Page bodies are not reachable
client-side in bulk today.** The `pages` table has no content column
(`supabase/migrations/20260812000000_pages_graph_schema.sql`); bodies live in encrypted snapshots
(`<pageId>/main_state.bin`) that only the sync server decrypts, and the editor receives the *current*
Page over the y-websocket collab server. A whole-workspace export therefore cannot be assembled from
the client's dashboard state without choosing a content path. This is deliberately **not** solved by
adding a server export endpoint — that would violate story 13's client-side guarantee.

Options to settle in the child task (owner: Dev):
1. **Client batch-sync**: open each Page's collab doc briefly (`WebsocketProvider` + wait for sync,
   read `Y.encodeStateAsUpdate` → `MarkdownEngine.parse`), bounded concurrency. Fully client-side,
   but touches the sync server and needs a progress UI.
2. **Local-first snapshot**: prefer `y-indexeddb` copies the client already has, sync only the gaps.

Whichever is chosen, the pure builder (`buildVaultFiles`/`buildVaultZip`) and the `FidelityReport`
shape in this spec are the stable seam the loader feeds; they do not change.

## 6. Test plan (three seams)

- **Seam 2** `tests/unit/vault-export.test.ts` (new): nested workspace fixture → unzip with
  `fflate.unzipSync` → assert folder paths mirror nesting, frontmatter/tags/callout/wikilinks present
  in the `.md`, attachments written and referenced relatively, unresolved links counted, folder pages
  not emitted as notes. Client-side guarantee: spy `global.fetch` and assert zero calls.
- **Seam 2** `tests/unit/markdown-engine.test.ts` (+): `serializeObsidianPage` frontmatter/body.
- **Report** `tests/unit/fidelity-report.test.ts` (new): import→export direction mapping.
- Existing `tests/unit/import-dialog.test.tsx` stays green through the component adapter.
- Fixture: committed real vault under `tests/fixtures/vaults/<name>/` used as the unzip-and-assert
  oracle.

## 7. Definition of Done

`npm run typecheck && npm run lint && npm test && npm run build` green; fixture committed; QA owns
drop-into-real-Obsidian dogfood before REVIEW; clean-room review artifact `docs/reviews/pr-60-review.md`.
