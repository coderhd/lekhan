# Spec: S1 — Clipboard paste-in (Obsidian markdown + Notion HTML into the graph)

- **Issue:** [SIL-57](/SIL/issues/SIL-57) · **Epic:** [SIL-9](/SIL/issues/SIL-9) (#78 H1 Dual-Interop Bridge)
- **Accepted plan:** [plan rev 1](/SIL/issues/SIL-9#document-plan) §3-S1 · **Source spec:** [#78](https://github.com/coderhd/lekhan/issues/78) stories 21–24
- **Stage:** DEFINE (6-stage lifecycle, `AGENTS.md`) · **Owner:** Dev Engineer
- **Status:** draft for review · **Branch:** `feat/57-clipboard-paste-in`
- **Marketing constraint:** *compatibility, never live sync* — no UI copy may imply sync.

---

## 1. Objective

When a user copies content in Obsidian or Notion and pastes it into a Lekhan Page, the content
must land as first-class Lekhan structures — callouts, Page properties, Tags, and Page links —
not as inert text. Unresolvable `[[targets]]` stay visible as unresolved Page links so the graph
can complete later. This is the smallest end-to-end slice of the #78 bridge: clipboard *in*.

**Who hits this:** users who think in both tools and paste snippets/notes between them.
**What breaks without it:** `[[wikilinks]]` arrive as literal brackets, callouts flatten to quotes,
YAML frontmatter arrives as raw text, and Notion page mentions arrive as dead links.

**Success looks like:** paste an Obsidian note or a Notion page and the resulting Page has native
callout nodes, Page properties from frontmatter, Tags indexed, resolved Page links where targets
exist, and visibly unresolved Page links where they do not.

## 2. Scope

In scope (stories 21–24 + plan §1 gap 2):

- **Obsidian-dialect markdown paste** — callouts (`> [!type]`, `-` collapsed form), YAML frontmatter →
  Page properties, inline `#tags`, wikilinks `[[Page]]` and alias form `[[Page|Alias]]`.
- **Notion-copied HTML paste** — converts to native nodes; internal page mentions become Page links
  where targets exist.
- **Three link states** — resolved / unresolved / external render distinctly.
- **Retroactive link resolution (gap 2)** — creating a Page resolves matching `page_links.to_page_id IS NULL`
  rows **without** requiring the source Page to be re-saved/re-indexed.
- **Web + desktop parity (story 24)** — one implementation; no Tauri-native code.

Out of scope (carried from plan §6): live/continuous sync; recreating Notion views/filters/formulas/
rollups/synced blocks; executing Dataview/DQL (preserved inert); Canvas files; Notion
comments/permissions/embeds; Lekhan→Lekhan clipboard as a UX; clipboard copy-out (S3).

## 3. Domain terms (`CONTEXT.md`)

- **Page properties** — structured metadata attached to a page (frontmatter on import).
- **Page link** — directed connection created by a `[[wikilink]]`; may be unresolved when the target
  title has no page yet.
- **Tag** — a `#tag` label indexed for filtering and the graph view.
- **Graph index** — incrementally maintained store of links, tags, search text.
- **Importer** — converter from a foreign source into the graph via the shared pipeline.

## 4. Current-state audit (evidence at `origin/main`)

| Concern | State | Evidence |
|---|---|---|
| Paste seam | Exists | `components/editor-workspace.tsx` `handlePaste` → `decideMarkdownPaste` → `storage.markdown.parser.parse` → `insertParsedHtml` |
| Classification | Markdown-only | `lib/markdown-paste.ts` returns `markdown` / `codeBlock` / `default` |
| Obsidian callouts | Parse + serialize | `lib/callout.ts` core rule + `Callout` node; `tests/unit/callout.test.ts` |
| Wikilinks | Parse + decorate | `lib/wikilink.ts` — resolved/unresolved decoration classes; click-to-create |
| Frontmatter → properties | Engine + file import only | `markdownEngine.parseFrontmatter`, `services/import.ts`; **not** wired to paste |
| Inline tags | Indexed server-side | `server/graph-index.js` `extractTags`; `page_tags` via `sync_page_graph` |
| Unresolved links | Nullable target | `page_links.to_page_id` nullable (`20260812000000_pages_graph_schema.sql`) |
| Retroactive resolution | **Missing** | `sync_page_graph` only resolves the page being indexed; `createPage` never touches `page_links` |
| Notion code | Absent | greenfield (gap 1 audit) |

## 5. Requirements

### R1 — Obsidian markdown paste
- A paste whose `text/plain` carries Obsidian constructs is routed through the markdown parser
  (never the code-block branch), including when `text/html` wraps it in `<pre>`.
- Callouts parse to `callout` nodes (type/title/collapsed).
- Leading YAML frontmatter is extracted **before** body parsing: `title`/`tags` reserved; all other
  keys become Page properties; `tags` (string or array) become a Tag property and index.
- Body `[[Page]]` / `[[Page|Alias]]` survive as text and decorate as Page links; alias renders.
- Body `#tag` tokens are indexed.

### R2 — Notion HTML paste
- Notion-copied `text/html` is converted to native nodes (headings, lists, tables, quotes, code,
  links, bold/italic, callout-equivalent blockquotes) — same schema as any paste.
- Notion internal page mentions/links (`notion.so` / `notion.site` URLs, mention spans) become
  `[[Page Title]]` text so the wikilink layer resolves them where a target exists.
- Genuinely external URLs remain normal links (the "external" state).

### R3 — Three link states
- **Resolved** — target Page exists → solid wikilink, click navigates.
- **Unresolved** — no target Page → dashed wikilink, click creates (`onCreatePage`).
- **External** — non-wikilink URL → normal Link mark, opens externally.
- Paste must not turn an external URL into a wikilink, nor a page mention into a dead `<a>`.

### R4 — Retroactive resolution (gap 2)
- Creating a Page resolves every existing `page_links` row in the same Workspace whose normalized
  `to_title` matches the new Page's normalized title and whose `to_page_id IS NULL`.
- Resolution happens **without** re-saving or re-indexing the source Page.
- Title normalization must match the JS `normalizeTitle` (lowercase, trim, collapse whitespace).

### R5 — Parity & copy honesty
- One implementation (shared lib) serves web and the desktop web view; no Tauri-native code.
- No UI copy in the paste path may say "sync" or imply continuous sync.

### R6 — No regressions
- Existing `decideMarkdownPaste` behavior and `transformCopiedText` tests stay green.
- Real code blocks from editors still paste as code blocks; tables still classify correctly.

## 6. Design

### 6.1 Classification (extend `lib/markdown-paste.ts`)
Add a source-aware classifier used by `handlePaste`; keep `decideMarkdownPaste` behavior for
existing callers/tests.

```
type ClipboardPasteKind =
  | 'obsidian-markdown'   // frontmatter | callout | wikilink | inline tag
  | 'notion-html'         // notion host markers in text/html
  | 'markdown'            // existing GFM behavior
  | 'codeBlock'
  | 'default'
```

- `classifyClipboardPaste(plain, html)`:
  1. no plain text → `default`
  2. Notion HTML detected (`notion.so`/`notion.site`/`data-notion` markers) **and** plain text not
     already Obsidian-markdown → `notion-html`
  3. Obsidian markers present (`^---\n` frontmatter, `> [!`, `[[…]]`, `#tag`) → `obsidian-markdown`
  4. existing `decideMarkdownPaste` result (`markdown`/`codeBlock`/`default`)
- `decideMarkdownPaste` keeps its current return contract; `'obsidian-markdown'` is treated as
  `'markdown'` for any legacy consumer.

### 6.2 Obsidian markdown pipeline
`lib/obsidian-clipboard.ts` (new, pure, framework-free):
- `splitObsidianFrontmatter(text)` → `{ properties, tags, body }` using `markdownEngine.parseFrontmatter`.
- `parseObsidianClipboard(text)` → `{ properties, tags, body }` (no editor instance).
- Callouts/tags/wikilinks need **no new parser** — `lib/callout.ts`, `server/graph-index.js`, and
  `lib/wikilink.ts` already cover them once the body reaches the markdown parser and graph indexer.

Wire-up in `handlePaste`:
- `obsidian-markdown` ⇒ extract frontmatter, parse body via the markdown parser, insert, and invoke
  `onPageProperties(properties, tags)` when non-empty.

### 6.3 Notion HTML pipeline
`lib/notion-clipboard.ts` (new, pure, DOM-based so it runs in web + desktop web view and jsdom tests):
- `isNotionHtml(html)` — host/marker detection.
- `notionHtmlToMarkdown(html)` — walk Notion's exported DOM, emit Obsidian-flavored markdown:
  - headings/lists/tables/blockquotes/code/fenced blocks → GFM
  - internal mention anchors → `[[Title]]` (title from anchor text, decodes `%20` and Notion slugs)
  - external anchors → `[text](url)`
  - callout blocks → `> [!type]` where a Notion callout is recognized
- The emitted markdown is then run through the existing markdown pipeline (so Notion paste reuses the
  same nodes and graph indexing as Obsidian paste). If conversion fails or yields empty output, fall
  back to the native HTML paste branch (never lose content).

### 6.4 Retroactive resolution (gap 2)
Migration `supabase/migrations/<ts>_resolve_unresolved_page_links.sql`:
- `public.normalize_page_title(text) RETURNS text` (IMMUTABLE): lower(trim(collapse whitespace)).
- `public.resolve_unresolved_page_links()` trigger function: `AFTER INSERT OR UPDATE OF title ON public.pages`,
  `SECURITY DEFINER SET search_path = public`, updates `page_links SET to_page_id = NEW.id`
  `WHERE workspace_id = NEW.workspace_id AND to_page_id IS NULL AND normalize_page_title(to_title) = normalize_page_title(NEW.title)`.
- One-time backfill UPDATE for existing pages.
- Why a trigger: `createPage` runs on the client under RLS, and `page_links` has no authenticated
  write policy — resolution must be server-side and must not depend on the source page being saved.

### 6.5 UI states
No new component required. `lib/wikilink.ts` already emits `wikilink-resolved` / `wikilink-unresolved`
decoration classes; external links ride the existing `Link` extension. The spec adds a **test** that
asserts all three states are produced from pasted content.

## 7. Acceptance criteria (Given/When/Then)

- **AC1** Given a recorded Obsidian clipboard payload (dual `text/html`+`text/plain`), when pasted,
  then the document contains a `callout` node with the source type, frontmatter becomes Page
  properties (reserved keys excluded), tags are indexed, and `[[…]]` links decorate resolved/unresolved.
- **AC2** Given a recorded Notion clipboard payload, when pasted, then the document contains native
  nodes; internal mentions with an existing target become resolved Page links; mentions without a
  target remain visible unresolved Page links; external URLs remain external links.
- **AC3** Given a Workspace with a Page containing `[[Missing]]` (unresolved), when a Page titled
  `Missing` is created, then that `page_links` row has `to_page_id` set without re-saving the source.
- **AC4** Given the existing markdown-paste and code-block/table suites, when run, they stay green.
- **AC5** The same paste implementation is exercised by web and desktop (shared components/lib; no
  platform branches).
- **AC6** Recorded fixtures for AC1/AC2 are committed under `tests/fixtures/clipboard/`.

## 8. Commands / structure / boundaries

- Build `npm run build` · Test `npm test` · Lint `npm run lint` · Typecheck `npm run typecheck` · Dev `npm run dev`
- New source: `lib/obsidian-clipboard.ts`, `lib/notion-clipboard.ts`; edits to `lib/markdown-paste.ts`,
  `components/editor-workspace.tsx`, `services/graph.ts`; migration under `supabase/migrations/`.
- Tests: `tests/unit/clipboard-paste.test.ts` (seam 3), `tests/fixtures/clipboard/*` (recorded payloads).
- Always: run tests before commit; keep `decideMarkdownPaste` contract; use `lib/markdown/engine.ts`, not `lib/markdown-io.ts`.
- Ask first: adding dependencies; changing `page_links`/`pages` schema beyond the resolution trigger.
- Never: commit secrets; imply sync in UI copy; execute Dataview/DQL; touch `lib/markdown-io.ts`.

## 9. Test seams (exactly three; plan §6)

1. **importer → IR → graph** — exercised by the retroactive-resolution migration (DB-level; QA runs it).
2. **markdown round-trip serializer** — untouched, must stay green.
3. **Tiptap clipboard parser/serializer** — the primary seam for this slice: feed recorded dual
   payloads through classification + parser and assert the resulting document/graph.

External behavior only; never assert internal module shape. Fixtures are committed real-world samples.

## 10. Risks / edge cases

- **Notion HTML variance** — export/HTML shapes differ by version; conversion must degrade to native
  HTML rather than drop content. Fixtures pin the sampled shape.
- **Frontmatter false positives** — a body starting with `---` (hr) must not be eaten as frontmatter;
  only a well-formed leading YAML block counts (`gray-matter` semantics).
- **Normalization parity** — SQL and JS normalization must agree or retroactive resolution silently
  misses. AC3 pins the case-insensitive/whitespace collapse.
- **RLS / privilege** — the trigger is `SECURITY DEFINER`; QA must verify it cannot be invoked to
  cross Workspace boundaries (scoped by `workspace_id`).
- **Alias links** — `[[Page|Alias]]` must resolve on `Page` and display `Alias`.

## 11. Open questions

- None blocking. Notion fixture shape is pinned by committed samples; if a future Notion version emits
  a new marker, extend `isNotionHtml` (task T6) rather than the classifier.

## 12. Success criteria

- All AC1–AC6 provable by committed tests/fixtures or migration.
- `npm run typecheck && npm run lint && npm test && npm run build` green.
- No regression in `markdown-paste`, `callout`, `wikilink`, `markdown-engine`, `graph-index` suites.
