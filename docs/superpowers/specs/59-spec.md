# SIL-59 / S3 — Clipboard copy-out: Obsidian-flavored markdown + Notion-friendly HTML

**Stage 1 (DEFINE) spec** · Owner: Dev Engineer · Epic: SIL-9 (#78 H1 Dual-Dialect Interop Bridge) · Plan: §3-S3
**Branch:** `feat/59-clipboard-copy` (from `origin/main` @ 89cfec4) · Status: accepted scope, building

## 1. Problem

Copying from the Lekhan editor today routes only through `tiptap-markdown`'s
`transformCopiedText`, which writes a single `text/plain` markdown payload. There is no
`text/html` payload, no Obsidian-specific guarantees (frontmatter from Page properties, callout
markers), and no fidelity contract for the paste target. A user who copies a Page and pastes into
Obsidian or Notion gets whichever partial representation the generic serializer produced.

S3 is the outbound half of the clipboard bridge: make the clipboard carry **both dialects at once**,
so the paste target picks the representation it understands.

## 2. Scope

At the existing editor copy seam (`components/editor-workspace.tsx`), replace the single-payload
copy with a handler that writes **dual clipboard payloads**:

- **`text/plain` = Obsidian-flavored markdown** produced by a new **Obsidian profile** on the
  round-trip serializer (`lib/markdown/engine.ts`, seam 2):
  - `[[Page]]` wikilinks and the `[[Page|Alias]]` alias form preserved verbatim;
  - callout markers `> [!type]` / `> [!type]-` with optional title;
  - YAML frontmatter generated from Page properties (`title`, `tags`, remaining properties);
  - inline `#tags`.
- **`text/html` = Notion-friendly HTML** from a dedicated serializer tuned to Notion's paste
  converter: real `<h1>`–`<h3>`, callout-equivalent `<blockquote>` blocks, `<ul>/<ol>/<li>`,
  headline `<table>`s, and genuine `<a href>` links.
- One implementation shared by web and desktop (story 24 parity — desktop wraps the same web editor).

## 3. Non-goals (carried constraints, plan §6)

- **Compatibility, never live sync.** No copy affordance may imply sync. Copy-out is a one-shot
  document transfer.
- Not Lekhan→Lekhan clipboard as a UX (that already works in-editor).
- No Canvas files, no Dataview/DQL execution.
- The legacy `lib/markdown-io.ts` facade is gone (ADR 0005 / SIL-54); all serializer work targets
  `lib/markdown/engine.ts`.
- Notion **API** push / OAuth is S5-S7, not this slice.
- Notion cannot resolve `[[wikilinks]]` on clipboard paste (no page identity exists in the target
  workspace); wikilinks stay literal text in the HTML payload. The page-mention path is the S5 push
  path. Named here so it is honest, not silent.

## 4. Acceptance criteria (restated from the issue)

1. Copy-out of a Page carrying wikilinks, callouts, frontmatter, and tags pastes into a real Obsidian
   vault and renders natively; pastes into a real Notion page and converts cleanly. Proven by
   committed clipboard fixtures (both MIME types) captured from the real apps, plus QA dogfood.
2. **Round-trip guarantee:** `serialize(Obsidian) → parse` is IR-identity for every construct in the
   suite; property tests over the construct corpus.
3. First artifact is this spec (`docs/superpowers/specs/59-spec.md`).

## 5. Construct corpus (the contract)

| Construct | `text/plain` (Obsidian) | `text/html` (Notion) |
|---|---|---|
| Heading 1-3 | `# …` / `## …` / `### …` | `<h1>`–`<h3>` |
| Paragraph + marks | `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `<u>`, `==highlight==` | `<strong>`, `<em>`, `<s>`, `<code>`, `<u>`, `<mark>` |
| Bullet / ordered list | `- ` / `1. ` | `<ul><li>` / `<ol><li>` |
| Task list | `- [ ]` / `- [x]` | `<ul><li>` + disabled checkbox input |
| Link (real URL) | `[text](url)` | `<a href="url">text</a>` |
| Wikilink resolved/unresolved | `[[Page]]` / `[[Page\|Alias]]` | literal `[[Page]]` text (see §3) |
| Inline tag | `#tag` | `#tag` text |
| Callout | `> [!type] title` + `> ` body | `<blockquote><p><strong>title</strong></p>…</blockquote>` |
| Blockquote | `> …` | `<blockquote>` |
| Code block | fence + language | `<pre><code class="language-x">` |
| Table | GFM pipe table | `<table><thead>/<tbody>` |
| Image | `![alt](src)` | `<img src alt>` |
| Horizontal rule | `---` | `<hr>` |
| Frontmatter (properties/tags/title) | `---` YAML block prepended (whole-Page copy only) | not emitted (Notion has no frontmatter) |

## 6. Design

### 6.1 Seam 2 — Obsidian profile on the engine

Add to `MarkdownEngine` (`lib/markdown/engine.ts`):

- `serializeObsidianBody(doc)` — body markdown via the existing export serializer (callouts,
  wikilinks, tags, tables, code already round-trip), placeholder heading stripped.
- `serializeObsidianPage(doc, meta)` — `assembleMarkdownFile(meta, serializeObsidianBody(doc))`;
  the named profile S4 reuses for vault export.

Move the placeholder-heading strip (`stripAutoHeading`) into the engine as the single source;
`lib/markdown-export.ts` imports it from there instead of defining its own copy.

### 6.2 Seam 3 — clipboard payload builder

New pure module `lib/markdown/clipboard.ts`:

```ts
export interface ClipboardPageMeta {
  title?: string
  tags?: string[]
  properties?: Record<string, unknown>
}
export interface ClipboardPayload { text: string; html: string }

// ESLint: function is pure — doc JSON + meta in, payload out.
export function buildClipboardPayload(
  doc: JSONContent,
  meta: ClipboardPageMeta,
  opts: { wholePage: boolean },
): ClipboardPayload
```

`buildClipboardPayload` calls `markdownEngine.serializeObsidianPage` (whole page) or
`serializeObsidianBody` (selection) for `text`, and `serializeNotionHtml(doc)` for `html`.

New pure module `lib/markdown/notion-html.ts` — `serializeNotionHtml(doc): string`, a
schema-driven JSON walker (no DOM, no Tiptap editor instantiation) so the Notion mapping is
unit-testable and independent of the live schema. It mirrors the already-shipped callout HTML class
names so the `.html` export and clipboard HTML stay visually consistent.

### 6.3 Editor copy handler

In `components/editor-workspace.tsx` `editorProps.handleDOMEvents.copy`:

1. If the selection is empty, return `false` (native copy).
2. Compute the selection doc: whole-page (`from === 0 && to === doc.content.size`) → `doc.toJSON()`;
   otherwise `doc.cut(from, to).toJSON()`, normalized so any leaked top-level inline nodes are wrapped
   in a paragraph (keeps the doc valid for the `block+` schema).
3. Build the payload from the live Page meta held in a ref (`title` always; `tags`/`properties`
   loaded once on mount via `fetchPageTags` / `fetchPageDetails`, best-effort).
4. On success: `event.preventDefault()`, `setData('text/plain', …)`, `setData('text/html', …)`,
   return `true`. On any serializer error: `console.warn` + return `false` (native copy still works).

Keep `transformCopiedText` off for the custom path (the handler owns both payloads). The paste seam
(`handlePaste` / `decideMarkdownPaste`) is unchanged.

## 7. Round-trip guarantee

For every construct in §5 (markdown-representable), assert:

```
const doc = engine.parse(markdown)
const roundTripped = engine.parse(engine.serializeObsidianBody(doc))
expect(roundTripped).toEqual(doc)          // IR identity
```

Property test: for each corpus fixture, `parse(serialize(parse(md))) === parse(md)` (idempotence),
and `serialize` output re-parses to the same IR. Fixtures are committed as real clipboard captures
under `tests/fixtures/clipboard/` (markdown, HTML, and a combined `text/html`+`text/plain` capture).

## 8. Edge cases

- Empty selection → native copy (no empty payload).
- Selection inside a single paragraph (inline slice) → wrap into a paragraph; never throw.
- Whole page with no properties/tags → no frontmatter block (engine returns body unchanged).
- Reserved keys in properties (`title`, `tags`) never duplicated — engine enforces.
- Unknown/unsupported nodes → serialize best-effort, never drop silently in markdown (engine);
  HTML walker renders children as a fallback.
- Very large selection → single synchronous pass; no async fetch on the copy path.

## 9. Test plan (three seams)

- **Seam 2** `tests/unit/markdown-engine.test.ts` (+): `serializeObsidianPage`/`serializeObsidianBody`
  round-trip for the corpus; frontmatter from properties/tags.
- **Seam 3** `tests/unit/clipboard.test.ts` (new): `buildClipboardPayload` dual payloads;
  `serializeNotionHtml` construct-by-construct; whole-page vs selection; round-trip property test
  over the corpus; committed clipboard fixtures re-parse to the same IR.
- Component wiring is covered by typecheck/build + a jsdom copy-event smoke test where feasible.

## 10. Definition of Done

`npm run typecheck && npm run lint && npm test && npm run build` green; fixtures committed; QA owns
paste-into-real-apps dogfood before the REVIEW gate; clean-room review artifact
`docs/reviews/pr-59-review.md`.
