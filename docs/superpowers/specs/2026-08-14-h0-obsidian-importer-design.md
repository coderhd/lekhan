# H0: Obsidian Importer — Design

**Date:** 2026-08-14
**Status:** Approved (design)
**Epic:** GitHub issue #27
**Strategy:** docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md (§13 migration, §3 pages-as-nodes)
**Rides on:** Epic #26 (Markdown Import/Export) — round-trip engine, frontmatter↔properties, graph-index `properties.tags` fold, headless Yjs seeding.

## Problem Statement

Obsidian users own vaults of markdown files that carry a set of conventions Lekhan must
understand: `[[wikilinks]]`, YAML frontmatter, `#tags`, `![[embeds]]`, callouts, code fences, and
a folder hierarchy that encodes the vault's organization. The strategy's anti-lock-in pitch —
"your data stays, the tool changes" — is hollow if moving an entire Obsidian vault into Lekhan
is manual or lossy. Today there is no way in at all; #26 (single-file markdown import/export) is
the substrate, and this epic is the first real importer on the pipeline.

## Solution

Import a whole Obsidian vault (ZIP upload, or a folder via the File System Access API with a
`webkitdirectory` fallback), preserving the conventions and landing it in the Lekhan graph:

- **Client** reads the vault and normalizes it into an intermediate representation (IR) — the
  strategy's `importer → normalize to IR → write into the graph` step. Each note → a page with
  `title`, `properties` (frontmatter), `tags`, editor content (incl. **first-class callouts**),
  a folder path (→ nested `parent_id` chain), and attachments (images → base64 embeds).
  `[[wikilinks]]` and `#tags` stay literal text so the graph index resolves them.
- **Server** `POST /api/import` writes the IR into the graph: creates pages (with the parent
  chain), persists each page's Yjs state to `documents/{pageId}/main_state.bin`, and indexes
  links/tags/searchable text via the existing `server/graph-index.js` → `sync_page_graph`.
- **Import report**: "X pages · Y links resolved · Z blocks degraded" — honest fidelity, no
  silent loss. This is the first-class import experience from strategy §13.

## User Stories

1. As an Obsidian user, I want to import my entire vault from a ZIP, so all my notes land in
   Lekhan at once.
2. As an Obsidian user, I want to import my vault from a folder on disk where the browser
   supports it, so I don't have to zip first.
3. As a user, I want the vault's folder hierarchy preserved as nested pages, so my organization
   is intact.
4. As a user, I want each note's YAML frontmatter to become the page's `properties`, so metadata
   survives.
5. As a user, I want frontmatter tags to become searchable `page_tags`.
6. As a user, I want `[[wikilinks]]` resolved against my other imported notes and my existing
   pages, so backlinks work after import.
7. As a user, I want wikilinks to pages I didn't import to stay unresolved rather than break.
8. As a user, I want `#tags` in note bodies indexed and searchable.
9. As a user, I want callouts rendered as callouts (not flattened blockquotes), so my notes keep
   their structure.
10. As a user, I want images referenced by `![[img.png]]` to appear as images in the imported
    pages.
11. As a user, I want code blocks with languages to keep their fences.
12. As a user, I want the importer to skip Obsidian's internal folders (`.obsidian/`,
    `.trash/`), so no junk pages appear.
13. As a user, I want a report after import — pages created, links resolved, blocks degraded —
    so I know exactly what made it and what didn't.
14. As a user, I want degraded blocks (non-image embeds, unsupported syntax) reported honestly,
    not silently dropped.
15. As a user, I want an empty vault or a vault with no markdown to error clearly instead of
    creating nothing.
16. As a user, I want imported pages to open, edit, sync, and search like normal Lekhan pages.
17. As a user, I want frontmatter `title` to win over the filename when both exist.
18. As a user, I want wikilinks with aliases (`[[Target|alias]]`) to keep the alias display text.
19. As a user importing a very large vault, I want a clear limit error rather than a crash.
20. As a user, I want attachment images to render like the images I add in the editor today
    (base64 embeds), with no public-storage setup.
21. As a user, I want imported content editable immediately and re-indexed on save like any edit.
22. As a user, I want the same importer path reused for future formats (Notion), so my workflow
    is consistent.

## Implementation Decisions

### 1. Client-side ingestion + IR; server-side write (the pipeline's write stage)

**`services/obsidian-import.ts`** (client) owns all parsing and normalizes to an IR:

- `readVaultZip(zipFile: File)` — unzip via `jszip` (new dependency).
- `readVaultFiles(files: File[])` — folder picker: `showDirectoryPicker` where available,
  `<input type="file" webkitdirectory>` fallback (recursive read).
- Enumerate `.md` / `.markdown`; **skip** `.obsidian/`, `.trash/`, `.canvas`, and any
  non-markdown file. Folders map to the page chain; a folder with no notes still becomes a
  parent page so the hierarchy is preserved.
- Per note: `parseFrontmatter` + `parseMarkdown` (from the #26 engine) → `title` (frontmatter
  `title` wins over filename), `properties`, `tags`, content (`JSONContent`), `plainText`.
- Attachments: `![[name.ext]]` with an image extension → base64 data-URL image embed
  (matches the current editor's image behavior — no storage/policy changes). Non-image embeds
  (`![[note]]`) degrade to `[[note]]` wikilinks and count as degraded.
- `[[wikilinks]]`/`#tags` remain literal text in the content; resolution happens in the graph
  index (see §3).
- Fidelity counts for the report: pages, folder-pages, links (resolved vs unresolved, by title
  lookup against imported + existing workspace pages), degraded blocks (non-image embeds,
  unsupported syntax, callouts are NOT degraded — they are preserved).
- IR shape (the pipeline's canonical write contract):

  ```ts
  type ObsidianImportIR = {
    workspaceId: string
    pages: Array<{
      title: string
      folderPath: string | null          // "guides/foo" → parent chain guides → foo
      properties: Record<string, unknown>
      tags: string[]
      contentYjsBase64: string           // client-built Yjs state for the page doc
      plainText: string                  // for searchable_text + link/tag extraction
    }>
  }
  ```

  `contentYjsBase64` is produced client-side by the **headless-editor seeding helper** shared
  with #26's hydrate-on-open (build a Y.Doc, set parsed content, `Y.encodeStateAsUpdate`).
  This keeps all Tiptap/extension logic (incl. the callout node) client-side.

### 2. First-class callout node (new, added to the shared schema)

Obsidian callouts (`> [!note] Title`) are preserved, not flattened:

- A new Tiptap `Callout` extension joins the shared schema in `lib/editor-extensions.ts` (the
  schema extracted by MI-T1). Serialization emits the Obsidian-compatible `> [!type] title`
  syntax; parsing recognizes it on import; the editor renders callouts with type-based styling.
- The round-trip engine (`lib/markdown-io.ts`) therefore round-trips callouts, and the paste
  path inherits them. Because the #26 engine is not yet implemented, the callout extension is
  simply part of the shared schema from the start — no rework of delivered code.

### 3. Server write endpoint `app/api/import/route.ts`

Mirrors the established `app/api/version/route.ts` pattern (caller-JWT client for RLS +
`supabaseAdmin` service-key client):

- Authenticate via the caller's JWT; **verify the caller owns the target workspace**
  (`workspaces.owner_id = user.id`) through a trusted service-role lookup.
- Enforce limits with the existing `readJsonWithLimit` + a max page count; clear 4xx errors.
- Create pages: ensure the folder-page chain (create folder-pages with empty content and
  `parent_id` links as needed), then each leaf page with `title`/`properties`/`parent_id`.
- Persist each page's Yjs state to `documents/{pageId}/main_state.bin` (service key, upsert).
- Index via the **existing** `server/graph-index.js` `indexPage(admin, pageId, plainText)` →
  `sync_page_graph`: links resolved against the workspace (including just-imported pages),
  tags indexed (incl. `properties.tags` via the #26 fold), `searchable_text` set.
- Return per-page ids and success; the client shows the report computed from the IR.

### 4. Import UX

Dashboard Import action grows a vault option beside #26's markdown-file import:

- A dialog with "Markdown file" (#26) and "Obsidian vault (ZIP / folder)" choices; the vault
  path offers both a ZIP file input and a folder picker.
- Progress during ingestion and during the server write; then the **import report** card:
  "X pages · Y links resolved · Z blocks degraded" with a breakdown and a way to jump into the
  imported pages.
- Clear errors for empty/no-markdown vaults and limit breaches.

### 5. Fidelity rules and edge cases

- **Wikilinks:** literal text; graph index resolves by normalized title against workspace pages
  (imported first, existing included). Aliases preserved as display text (`[[Target|alias]]`).
- **Callouts:** preserved as callout nodes; never degraded in H0's report.
- **Embeds:** image embeds → base64; non-image embeds → `[[wikilink]]` (degraded, reported).
- **Folders:** hierarchy → nested pages; folder pages created even when a folder has no notes.
- **Skipped:** `.obsidian/`, `.trash/`, `.canvas`, non-markdown binaries.
- **Code fences, tables, task lists, images, links:** inherit the #26 round-trip fidelity.
- **Frontmatter:** title/properties/tags mapping identical to #26 (reserved keys `title`,
  `tags`; `tags` → `properties.tags` + `page_tags`).

## Testing Decisions

A good test here asserts **vault-in → graph-out behavior** — a fixture vault normalizes to the
right IR, the write stage persists and indexes it, and the report counts are truthful — not
internal parsing details.

- **Unit — callout node:** `> [!note]`/`> [!warning]` round-trip through serialize/parse; node
  present in the shared schema; render test.
- **Unit — ingestion:** `tests/unit/obsidian-import.test.ts` — a jszip-constructed fixture vault
  (folders, frontmatter, wikilinks incl. aliases, `#tags`, callouts, fenced code, images,
  `.obsidian/` junk, `.trash/`, `.canvas`) normalizes to the expected IR: folder chain,
  frontmatter→properties/tags, image→base64, wikilink preservation, skip rules, and correct
  report counts (resolved vs unresolved links, degraded embeds).
- **Unit — write stage:** a service-level test (mocked `supabaseAdmin`) — workspace-ownership
  check, page + folder-page creation with `parent_id`, storage upload per page, `indexPage`
  invoked per page, limits enforced.
- **Unit — UX:** import dialog flow and report rendering (mocked ingestion + write), following
  the global-search-palette test pattern.
- **Gates:** focused vitest files only, `npm run lint`, `npm run build`.

## Out of Scope

- Canvas files (→ H2 board view) and graph-layout metadata (deferred).
- Storage-backed attachments / a public media bucket (base64 embeds in H0).
- Transclusion rendering (`![[note]]` as an inline embed) — degrades to a wikilink.
- Obsidian sync config, community plugins, themes.
- Notion importer (#45) and later importers — but they reuse the same IR + write endpoint.
- Importing into an already-open page.

## Further Notes

- The IR + `/api/import` write stage is the canonical "write into the graph" step of the
  strategy's one-pipeline-many-importers design; #45 Notion normalizes its HTML+CSV export into
  the same IR.
- Reuses from #26: the round-trip engine and frontmatter mapping, the headless Yjs seeding
  helper, and the graph-index `properties.tags` fold. The callout extension is the one addition
  to the shared schema, landing with (not after) the engine.