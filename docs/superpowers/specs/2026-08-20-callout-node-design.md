# OI-T1 #60 — Callout node (first-class, round-trip)

**Status:** Approved for implementation
**Epic:** #27 — H0 — Obsidian Importer
**Date:** 2026-08-20
**Blocker for:** #74 — Export: styled standalone HTML

---

## 1. Goal

Make Obsidian callouts (`> [!note] Title`) first-class: preserved through the
round-trip engine instead of flattened to a plain blockquote, and rendered as a
styled, interactive card in the live editor. The callout is the first node in the
shared schema that needs a React node view, so it also establishes that pattern.

Out of scope (tracked separately):

- Removing the `.mdx` export option — #73 (the engine is markdown-it based; it does
  not emit real MDX, so `.mdx` is a misleading duplicate of `.md`).
- General styled standalone-HTML export — #74 (this ticket only adds the callout's
  own export styles; generalizing is #74's job).

## 2. Decisions

### 2.1 Callout model

- **Type:** fixed known set (`note`, `warning`, `info`, `tip`, `success`, `danger`,
  `question`) **plus passthrough** — unknown types are preserved as-is (Obsidian
  supports arbitrary `[!custom]` types) and render with neutral styling.
- **Title:** an explicit `title` attribute, separate from content. Obsidian's
  `> [!note] Title here` puts the title on the marker line.
- **Collapsed:** a boolean `collapsed` flag. Obsidian writes `> [!note]-` to start
  collapsed. This ticket **round-trips** the flag and renders the collapsed state;
  the interactive toggle is part of this ticket (see §2.4).

### 2.2 Rendering: React node view

Rendering uses `ReactNodeViewRenderer` (a new pattern in this repo — no existing
usage). The callout renders as a styled card:

- `.callout-title` — type icon + title (Obsidian structure).
- `.callout-content` — the editable body, via `NodeViewContent`.
- Known types get per-type accent color + icon; unknown types get neutral styling.
- The title row is a toggle button: clicking flips `collapsed` via
  `updateAttributes`, and the body hides/shows accordingly. This is the
  interactivity that a plain `renderHTML` node cannot provide.

`renderHTML` still exists on the node as the **fallback** for headless contexts
(HTML export via `serializeExportBodyHtml`, version-restore preview) where a React
view is never mounted. It emits the same `<div data-callout …>` structure the node
view uses.

### 2.3 Markdown round-trip (Obsidian-compatible)

- **Serialize** emits `> [!type] title` then each body line prefixed with `> `
  (via `wrapBlock("> ", …)`, the prosemirror-markdown blockquote helper). Collapsed
  callouts emit `> [!type]- title`.
- **Parse** uses tiptap-markdown's `parse.setup` core-rule hook: a markdown-it rule
  that matches blockquote tokens whose first line is `[!type]`, rewriting the
  blockquote group so it renders as `<div data-callout …>` (matched by the node's
  `parseHTML`). Plain blockquotes (no `[!type]`) are untouched.

### 2.4 Interactivity scope

The interactive collapse toggle **is** in scope (that's why we chose the React node
view). Collapsed callouts render collapsed with a clickable title that expands them.

### 2.5 Export HTML

The callout's `renderHTML` fallback produces **semantic** markup:
`<div class="callout callout-note" data-callout-type="note">` with the title in the
structure. For the standalone `.html` export, this ticket adds a small **callout
stylesheet** to `buildStandaloneHtml` so exported callouts render styled (colored
accent per type, title row, collapsed state). This is the callout-shaped part of #74;
generalizing export styling to all nodes stays in #74.

## 3. Design

### 3.1 Node definition — `lib/callout.ts`

New file exporting a Tiptap `Callout` extension:

```ts
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,          // like blockquote: keep callouts intact on split/join
  draggable: true,

  addAttributes() {
    return {
      type: { default: 'note' },
      title: { default: '' },
      collapsed: { default: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]', getAttrs: (el) => ({
      type: el.getAttribute('data-callout-type') || 'note',
      title: el.getAttribute('data-callout-title') || '',
      collapsed: el.getAttribute('data-callout-collapsed') === 'true',
    }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { type, title, collapsed } = node.attrs
    return ['div', {
      ...HTMLAttributes,
      class: `callout callout-${type}`,
      'data-callout': '',
      'data-callout-type': type,
      'data-callout-title': title,
      'data-callout-collapsed': String(collapsed),
    }, title ? ['div', { class: 'callout-title' }, title] : [],
       ['div', { class: 'callout-content' }, 0]]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const { type, title, collapsed } = node.attrs
          const marker = collapsed ? `-` : ''
          state.write(`> [!${type}]${marker}${title ? ` ${title}` : ''}`)
          state.ensureNewLine()
          node.forEach((child) => {
            // wrapBlock writes the `> ` prefix for every line of `child` and
            // closes the child itself; do NOT call closeBlock here.
            state.wrapBlock('> ', null, child, () => state.renderContent(child))
          })
        },
        parse: { /* handled by markdown-it core rule, see §3.2 */ },
      },
    }
  },
})
```

The extension is added to `getSharedExtensions()` in `lib/editor-extensions.ts`, so
the live editor, paste path, round-trip engine, and export schemas all share it.

### 3.2 Parse rule — markdown-it core rule

In the callout extension's `addProseMirrorPlugins`/`addStorage`, hook
tiptap-markdown's `parse.setup`:

```ts
markdown: {
  parse: {
    setup(markdownit) {
      markdownit.core.ruler.push('lekhan_callout', (state) => {
        // for each blockquote token: if first paragraph begins with [!type]
        // (optionally followed by - and a title), convert to a callout token
        // carrying type/title/collapsed; keep everything else unchanged.
      })
    },
  },
}
```

The rule inspects `state.tokens`: a `blockquote_open` whose first child
paragraph's first inline token is `text` matching `/^\[!([a-z0-9]+)\](-?)(.*)$/i`
is rewritten — the blockquote token group is replaced by an `html_block` token
whose content is the `<div data-callout …>` markup (type/title/collapsed from the
marker line, body blocks re-rendered inside). markdown-it emits that HTML verbatim;
the schema's `parseHTML` (`div[data-callout]`) then matches it into a callout node.
Blockquotes that don't match are left untouched (regression-safe for plain
blockquotes). The marker line is consumed, never rendered as content.

### 3.3 Serialize

See §3.1 `addStorage.markdown.serialize`. `state.wrapBlock` comes from
prosemirror-markdown's serializer helpers (the same used by blockquote). Each body
block renders with the `> ` prefix; the `[!type]` marker line is written first.

### 3.4 Node view — `components/callout-node-view.tsx`

A React component + `ReactNodeViewRenderer`:

```tsx
const CalloutNodeView = ({ node, updateAttributes, selected }) => {
  const { type, title, collapsed } = node.attrs
  const toggle = () => updateAttributes({ collapsed: !collapsed })
  return (
    <div className={`callout callout-${type} ${selected ? 'selected' : ''}`} data-callout="">
      <button className="callout-title" onClick={toggle} aria-expanded={!collapsed}>
        <CalloutIcon type={type} /> <span>{title || defaultTitle(type)}</span>
      </button>
      {!collapsed && <NodeViewContent className="callout-content" />}
    </div>
  )
}
```

`CalloutIcon` maps each known type to a `lucide-react` icon (the codebase's icon
library); unknown types fall back to a neutral icon. The slash menu item itself uses
the Material-style string icon convention of `buildSlashMenuItems` (e.g.
`icon: 'chat_bubble_outline'`).

The `Callout` extension sets `addNodeView()` to `ReactNodeViewRenderer(CalloutNodeView)`
when running in the live editor. In headless editors (created in `lib/markdown-io.ts`)
the node view is never mounted, so `renderHTML` is what serialization uses — no SSR
surprises.

### 3.5 Slash menu + input rule

- **Slash menu:** add a "Callout" item to `buildSlashMenuItems`
  (`lib/slash-menu-extension.ts`) that inserts an empty callout at the cursor.
- **Input rule:** typing `> [!note]` at the start of a blockquote and pressing space
  converts it to a callout (mirrors Obsidian's muscle memory).

### 3.6 Styling — `app/globals.css`

`.callout` base (bordered box, rounded corners, left accent), per-type accent
colors, `.callout-title` (bold, icon + title, clickable), `.callout-content`. Mirrors
the existing task-list node styling pattern.

### 3.7 Export HTML styles

`buildStandaloneHtml` (`lib/markdown-export.ts`) gains an injected `<style>` block
covering the callout's classes (§2.5). This is scoped to callouts now; #74
generalizes it.

### 3.8 Data flow

No server/DB/graph changes. Callouts are pure editor content:

- **Import** (`services/import.ts` / Obsidian vault ingestion): markdown → round-trip
  engine → callout node. Inherited automatically from the shared schema.
- **Export** (`.md`): serialize path emits `> [!type] title`. Inherited.
- **Export** (`.html`): `renderHTML` fallback + injected styles. Inherited.
- **Version restore / preview:** `renderHTML` fallback renders the node.

## 4. Edge cases

- **Plain blockquote regression:** `> normal quote` must stay a blockquote — the parse
  rule only matches the `[!type]` marker.
- **Uppercase / spaced types:** Obsidian allows `[!NOTE]`, `[! Note]`, `[!warning]` —
  normalize case for matching, keep original for display if unknown.
- **Unknown type:** preserved verbatim, neutral styling (Obsidian behavior).
- **Collapsed round-trip:** `> [!note]-` → collapsed callout → `> [!note]-` (lossless).
- **Empty callout:** `> [!note]` with no body — renders with title only; not a crash.
- **Nested content:** callout body can contain paragraphs, lists, code — `block+`
  content + `wrapBlock` handles it.
- **MDX paste:** pasted JSX/MDX components (e.g. `<Alert />`) are **not** rendered as
  React components — the engine has no JSX parser; tags degrade to inner text or
  vanish. Documented limitation; callouts themselves are blockquote syntax, so they
  are unaffected.

## 5. Testing

Focused unit tests in `tests/unit/callout.test.ts`:

- **Parse:** `> [!note] Title\n> body` → callout node with `type: 'note'`, title,
  content. Plain blockquote stays a blockquote.
- **Serialize:** callout node → `> [!note] Title` + `> `-prefixed body.
- **Round-trip both directions:** doc → markdown → doc lossless, and reverse.
- **Collapsed:** `> [!warning]-` round-trips the flag both ways.
- **Unknown type:** `> [!custom]` preserved.
- **Slash menu:** item present in `buildSlashMenuItems`.
- **Export HTML:** callout renders semantic `div[data-callout]` via `renderHTML`; the
  standalone HTML includes the callout stylesheet.

Existing regression guard: the blockquote round-trip test in
`tests/unit/markdown-io.test.ts` (line ~65) must stay green.

## 6. Definition of done

- [ ] `Callout` extension in `lib/callout.ts`, added to `getSharedExtensions()`.
- [ ] Round-trip: callout → `> [!type] title` → callout (lossless); plain blockquotes
  unaffected.
- [ ] React node view renders styled card; title toggles collapsed interactively.
- [ ] Slash menu item + `> [!note]` input rule.
- [ ] Callout CSS in `app/globals.css`; callout styles in `buildStandaloneHtml`.
- [ ] `tests/unit/callout.test.ts` passes; full suite green; lint + build green.
- [ ] `.mdx` option removal and general HTML styling left to #73 / #74 respectively.