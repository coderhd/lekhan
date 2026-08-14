# H0: Markdown Import/Export (full round-trip) — Design

**Date:** 2026-08-14
**Status:** Approved (design)
**Epic:** GitHub issue #26
**Strategy:** docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md (§13 migration, §3 pages-as-nodes, §7.2 Free tier)

## Problem Statement

Lekhan pages live inside the app's Yjs/CRDT storage, with no way to get content out as plain
markdown or bring an existing `.md` file in. A user who wants to back up a note, move it to
another tool, or onboard an existing vault of markdown notes is stuck: the only exports are
PDF/DOCX, and those are gated behind paid plans. The strategy frames markdown portability as
the anti-lock-in play ("your data stays, the tool changes") and lists **markdown** as part of the
Free tier, yet today the escape hatch and the on-ramp are both missing — and both paywalled.

## Solution

A full markdown round-trip, **free on every tier**:

- **Export:** any page → a single `.md` file: YAML frontmatter (`title`, `properties`, `tags`)
  + the page body as GFM markdown. Also `.mdx` and `.html` variants. **PDF/DOCX export becomes
  free too** (the plan gate and upgrade modal are removed).
- **Import:** a `.md` file → a new page. Frontmatter → `pages.properties` + `page_tags`; body →
  rich editor content. `[[wikilinks]]` and `#tags` round-trip as literal text and are indexed by
  the existing graph index service, so imported pages participate in backlinks, tags, and search
  like any other page.

Both directions share **one round-trip engine** (Tiptap doc ↔ markdown, frontmatter ↔
properties) — the substrate the Obsidian importer (#27) and Notion importer (#45) later ride.

## User Stories

1. As a user, I want to export any page I own as a `.md` file, so I can back it up, edit it
   locally, or move it to another tool.
2. As a free user, I want markdown export to work without a paid plan, so the escape hatch is
   never paywalled.
3. As a user, I want the exported `.md` to start with YAML frontmatter containing the page
   title, so the title survives the round trip.
4. As a user, I want the page's `properties` written into the frontmatter, so structured data
   (numbers, booleans, arrays, nested objects) round-trips.
5. As a user, I want the page's tags written into the frontmatter as a `tags:` list, so tags
   round-trip and are preserved on re-import.
6. As a user, I want `[[wikilinks]]` to survive export as literal text, so my graph connections
   are not lost.
7. As a user, I want inline `#tags` in the body to survive export, so inline tags are preserved.
8. As a user, I want the exported body to be clean GFM markdown — headings, bold/italic/strike/
   underline/code, bullet and numbered lists, task lists, blockquotes, code fences (with
   language), tables, images, links, horizontal rules, hard breaks — so it reads and edits well
   in any markdown tool.
9. As a user, I want to import a `.md` file into a new page in my workspace, so I can bring my
   notes in.
10. As a user, I want the imported page's title to come from frontmatter `title` (falling back
    to the filename), so titles are preserved.
11. As a user, I want frontmatter keys to become the page's `properties`, so structured data
    comes in.
12. As a user, I want frontmatter `tags:` to become the page's tags, indexed and searchable via
    the tag surface, so tags come in.
13. As a user, I want the imported body rendered as rich editor content (headings, lists,
    tables, code blocks, task lists, images, links), so it looks like a normal Lekhan page.
14. As a user, I want `[[wikilinks]]` in imported markdown resolved against my existing pages by
    the graph index (unresolved links kept open when the target page doesn't exist), so
    backlinks work after import.
15. As a user, I want inline `#tags` in imported markdown indexed, so they're searchable.
16. As a user, I want to land on the imported page after import, so I can verify and keep
    working immediately.
17. As a user, I want a clear confirmation when an import succeeds, so I know it worked.
18. As a user, I want code fences to keep their language on both import and export, so syntax
    highlighting survives.
19. As a user, I want URL images to survive the round trip, so media references aren't lost.
20. As a user, I want to export a page as HTML, so I can paste it into emails or sites.
21. As a user, I want to export a page as MDX, so I can drop it into MDX-based docs sites.
22. As a user, I want DOCX and PDF export to be free like markdown, so the gating removal is
    consistent across all formats.
23. As a viewer on a shared page, I want no export/import actions shown, matching today's
    read-only behavior.
24. As a user importing a file with no frontmatter, I want it to import cleanly (title from
    filename, no properties).
25. As a user importing an empty or malformed file, I want a clear error rather than a broken
    page.
26. As a user importing content the editor can't represent (Obsidian callouts), I want it to
    degrade to a supported block (blockquote) without content being dropped.
27. As a user, I want the exported filename to be the page title (slugified), so files are
    recognizable.
28. As a user who edits an imported page, I want the normal sync and graph indexing to keep
    running, so the graph stays consistent after import.
29. As a user, I want a round-trip (`export → import → export`) to be stable, so I can trust
    markdown as a durable interchange format.

## Implementation Decisions

### 1. One round-trip engine (`lib/markdown-io.ts`)

A single pure module both import and export call, exposed as:

- `parseMarkdown(md: string): JSONContent` — markdown → Tiptap doc, via the `tiptap-markdown`
  parser configured with the editor's shared extensions.
- `serializeMarkdown(doc: JSONContent): string` — Tiptap doc → markdown, via the
  `tiptap-markdown` serializer.
- `parseFrontmatter(md: string): { data: Record<string, unknown>; body: string }` — via
  `gray-matter` (new dependency; its YAML parser/stringifier is used on both sides).
- `buildFrontmatter({ title, properties, tags }): string` — YAML frontmatter for export.
- `assembleMarkdownFile({ title, properties, tags, body }): string` — frontmatter + body.

The shared Tiptap extension list currently lives inside `components/editor-workspace.tsx`
(`getSharedExtensions`). It is **extracted to `lib/editor-extensions.ts`** so the live editor,
the paste path, and the headless round-trip engine all share one schema. This is the only
prefactor; everything else adds new code.

### 2. Frontmatter ↔ properties mapping

- **Reserved frontmatter keys:** `title` and `tags`. Every other key maps to `pages.properties`
  as its JSON value (primitives, arrays, nested objects preserved).
- **Import:** `data.title` → page title (fallback: slugified filename); `data.tags` →
  `pages.properties.tags` **and** `page_tags` rows; remaining keys → `pages.properties`.
- **Export:** `pages.properties` keys → frontmatter; tags → `tags:` list. Tag source of truth is
  `page_tags`; `properties.tags` is its round-trip mirror, so export reads `page_tags`
  (falling back to `properties.tags`).

### 3. Graph index folds `properties.tags` (one server change)

The graph index service (`server/graph-index.js` → `sync_page_graph`) currently extracts tags
only from body text. `indexPage`'s page lookup is extended to also read `pages.properties`, and
`properties.tags` (an array, or a comma/space-separated string) is folded into the tag rows
written via `sync_page_graph`. This is what makes imported frontmatter tags searchable, and it
keeps `page_tags` consistent with `properties.tags` for all future properties-driven content.
No other server change. `sync_page_graph` itself stays service-key-only; the client never calls
it.

### 4. Import write path — hydrate-on-open (client-side)

Import is a **single `.md` file → one new page** in H0 (bulk/vault handling is #27).

- `services/import.ts` — `importMarkdownFile(fileText, { workspaceId, ownerId })`:
  1. `parseFrontmatter` → title, properties, tags; `parseMarkdown(body)` → content.
  2. Create the page via the existing `createPage` (title + `properties`, tags stored in
     `properties.tags`).
  3. Stash the parsed body in a **per-tab payload store** (module-scoped Map surviving
     `router.push` in the same tab) keyed by the new page id, then navigate to `/page/{id}`.
- `components/editor-workspace.tsx` accepts an optional `initialContent` (markdown string).
  On first mount, if the editor doc is empty and `initialContent` is present, it parses and
  inserts the content, then clears the payload. Everything downstream — IndexedDB, websocket
  sync, `searchable_text`, `page_links`/`page_tags` via the sync server's save — is the
  **existing** collaboration path. The graph becomes consistent on the normal 3s debounced
  save, exactly as if the user had typed the content. No new server route, no direct storage
  writes, no client-side `sync_page_graph` call.
- A refresh before hydration clears the pending payload; the page simply opens empty. Malformed
  input surfaces a toast error and creates nothing.
- Import entry point is the dashboard (owner/editor only, which the dashboard already is).
  Importing into an already-open page is out of scope.

### 5. Export path — menu additions, all free

- The editor Export dropdown gains **Markdown (.md)**, **MDX (.mdx)**, and **HTML (.html)**
  items ahead of the existing DOCX/PDF items. All items are **ungated**: the plan check, the
  upgrade modal, and the PRO badge on the Export button are removed.
- `lib/export-utils.ts` (or a new `lib/markdown-export.ts`) gains:
  - Markdown: `assembleMarkdownFile` output — downloads as `<slugified-title>.md`.
  - MDX: the same markdown body (the `Markdown` extension runs with `html: true`, so inline
    HTML nodes are preserved), saved with `.mdx`. This is the **SSG-generation usecase**: the
    output is consumable by MDX-based docs toolchains such as Docusaurus for authoring docs in
    Lekhan and building them elsewhere. Clean GFM + preserved inline HTML is what makes the
    output valid MDX.
  - HTML: `editor.getHTML()` wrapped in a minimal standalone document, saved as `.html`.
- Export uses the live editor's serialized doc plus `fetchPageDetails(pageId)` and
  `fetchPageTags(pageId)` (both exist in `services/graph.ts`).
- Viewers keep no export menu (unchanged — the menu already renders only when `!isViewer`).

### 6. Fidelity rules and edge cases

- **Round-trip contract:** for a round-tripped page, `export → import → export` is stable
  (same file modulo formatting), and imported content never loses blocks.
- **Code fences:** language preserved on both directions.
- **Tables:** GFM tables round-trip (table extension already in the editor).
- **Task lists:** `- [ ]` / `- [x]` round-trip via `taskList`/`taskItem`.
- **Wikilinks:** literal `[[Target]]` text survives serialization unchanged (no wikilink Tiptap
  node in H0) and is resolved by the graph index. Unresolved targets stay open
  (`to_page_id` null).
- **Callouts** (`> [!note]` and Obsidian variants): no callout node in H0 — degrade to
  blockquote, content preserved. First-class callouts are #27/#38 territory.
- **Embeds** (`![[file]]`): preserved as literal text; image URL embeds surface as images.
  Binary attachment handling is #27.
- **Inline HTML:** preserved (MDX-ready) because the `Markdown` extension runs `html: true`.
- **Hard breaks, horizontal rules, images, links:** round-trip via the serializer.
- **Empty body:** exports frontmatter only; imports to an empty page.

## Testing Decisions

A good test here asserts **external round-trip behavior** — `serialize(parse(md))` and
`parse(serialize(doc))` stability per block type — not the internal Tiptap node shapes. The
round-trip engine is pure and headless, so all of it is unit-testable without a browser.

- **Unit — round-trip engine:** `tests/unit/markdown-io.test.ts` — for each supported block
  (headings, paragraphs, bullet/ordered/task lists, blockquotes, fenced code with language,
  GFM tables, images, links, inline marks, hard breaks, horizontal rules): parse→serialize and
  serialize→parse stability; frontmatter build/parse symmetry; properties ↔ frontmatter
  mapping incl. arrays and nested objects; reserved-key handling; frontmatter-less input.
  Prior art: `tests/unit/markdown-paste.test.ts` (headless Tiptap + markdown extension).
- **Unit — export:** `tests/unit/markdown-export.test.ts` — assembled file has correct
  frontmatter (title/properties/tags) + body; filename slugification; HTML wrapper; MDX body.
- **Unit — import service:** `tests/unit/markdown-import.test.ts` — parses file, creates page
  with title + properties (+ `properties.tags`), stashes payload keyed by page id,
  frontmatter-less files, malformed input error path. Mocked-supabase pattern (as in
  `tests/unit/search.test.ts`).
- **Unit — graph index extension:** `tests/unit/graph-index.test.ts` (new; the file is a
  CommonJS module with no current tests) — `properties.tags` (array and string forms) folded
  into tag rows; body tags still extracted; links unchanged.
- **Unit — hydration:** a focused test on the hydrate-on-open helper (headless editor mounts an
  empty doc, `initialContent` inserts, payload clears; non-empty doc untouched).
- **Gates:** focused vitest files only (full `npm run test` OOMs on this machine),
  `npm run lint`, `npm run build` (P2 lesson: vitest + eslint never type-check — `next build`
  is mandatory for any TS change).

## Out of Scope

- Vault/folder/zip import, folder hierarchy → nested pages, binary attachments (→ #27 Obsidian
  importer).
- Full import report with per-block degradation counts (→ #27).
- A wikilink Tiptap node / in-editor wikilink rendering (→ #38 graph view, #27 conventions).
- Notion importer (→ #45).
- Public pages / publish HTML rendering (→ #30/#40; HTML export here is a raw file only).
- In-app `properties` editing UI — properties are import/export-first in H0.
- First-class callout/embed nodes (degrade to blockquote/text).
- Workspace-wide / folder export.
- Importing into an existing open page; server-side import endpoints.

## Further Notes

- This is the **substrate of the import pipeline** (#26 → #27 → #45): the round-trip engine and
  the hydrate-on-open write path are what the Obsidian importer reuses for bulk imports.
- The graph-index `properties.tags` fold is a correctness fix that keeps `page_tags` and
  `properties` from ever disagreeing, independent of the importer.
- All exports free on every tier is an explicit decision from the maintainer (2026-08-14),
  aligning the product with strategy §7.2 (Free tier includes markdown) and the growth-channel
  framing in §13.