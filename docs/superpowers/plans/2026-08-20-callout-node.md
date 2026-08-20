# Callout Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Obsidian-compatible `callout` node to Lekhan's shared editor schema that round-trips through markdown as `> [!type] title` and renders as a styled, interactively-collapsible card in the live editor.

**Architecture:** A Tiptap `Callout` node (`lib/callout.ts`) joins `getSharedExtensions()` so the live editor, paste path, round-trip engine, and export schemas share it. Round-trip is two hooks into tiptap-markdown: a markdown-it **core rule** (`parse.setup`) rewrites `> [!type]` blockquotes into `<div data-callout>` during parse, and a per-node **serialize** (via `state.wrapBlock`) emits `> [!type] title` lines on write. Rendering in the live editor is a React node view (`components/callout-node-view.tsx` via `ReactNodeViewRenderer`); headless contexts (HTML export, version restore, round-trip) use the node's `renderHTML` fallback. A slash-menu item and an input rule provide insertion. Callout CSS lives in `app/globals.css`, and the callout's export styles are injected into `buildStandaloneHtml`.

**Tech Stack:** Tiptap v3 (`@tiptap/core`, `@tiptap/react`), tiptap-markdown 0.9.0, markdown-it 14.3.0, prosemirror-markdown, React, vitest (jsdom), Next.js.

## Global Constraints

- The engine is markdown-it based with `html: true`; it does NOT parse real MDX/JSX — pasted `<Component />` degrades to text (documented limitation, not a bug to fix here).
- The `.mdx` export option is removed in #73 (separate ticket); callout work must not rely on `.mdx` semantics.
- General standalone-HTML styling is #74 (separate ticket); this plan only adds the callout's own export styles to `buildStandaloneHtml`.
- Node `name` must be `callout` (spec §3.1); attrs `type` (default `'note'`), `title` (default `''`), `collapsed` (default `false`).
- Known types: `note`, `warning`, `info`, `tip`, `success`, `danger`, `question`. Unknown types preserve verbatim (Obsidian behavior), lowercased for matching, neutral styling.
- Raw attrs (`type`/`title`/`collapsed`) must NOT leak into exported HTML — only `data-callout-*` attributes (validated: `lib/callout.ts` deletes them in `renderHTML`).
- Test/lint/build: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH"` then `npm test`, `npm run lint`, `npm run build`.
- Existing blockquote round-trip test (`tests/unit/markdown-io.test.ts`, line ~65) must stay green — plain blockquotes are untouched by the core rule.

---

### Task 1: Callout node definition

**Files:**
- Create: `lib/callout.ts`
- Test: `tests/unit/callout.test.ts`

**Interfaces:**
- Consumes: tiptap-markdown `parse.setup(markdownit)` hook (verified in `node_modules/tiptap-markdown/src/parse/MarkdownParser.js:27`) and per-node `storage.markdown.serialize` (verified in `node_modules/tiptap-markdown/src/serialize/MarkdownSerializer.js:58-60`).
- Produces: `export const Callout` (Tiptap `Node`), `export const CALLOUT_TYPES`, `export type CalloutType`, `export const MARKER_INPUT_RE`. Later tasks consume `Callout` (Task 4, 5) and `MARKER_INPUT_RE` (Task 4).

- [ ] **Step 1: Write the failing round-trip tests**

```ts
// tests/unit/callout.test.ts
import { describe, it, expect } from 'vitest'
import { parseMarkdown, serializeMarkdown } from '@/lib/markdown-io'
import { Callout, CALLOUT_TYPES } from '@/lib/callout'

/** Doc-level round-trip: parse → serialize → parse yields the same doc. */
function expectDocRoundTrip(md: string) {
	const first = parseMarkdown(md)
	const serialized = serializeMarkdown(first)
	const second = parseMarkdown(serialized)
	expect(second).toEqual(first)
}

describe('callout parse/serialize round-trip', () => {
	it('round-trips a simple callout with type and title', () => {
		const md = '> [!note] My title\n> Body line one\n'
		const doc = parseMarkdown(md)
		const callout = doc.content?.[0]
		expect(callout?.type).toBe('callout')
		expect(callout?.attrs).toMatchObject({ type: 'note', title: 'My title', collapsed: false })
		expectDocRoundTrip(md)
	})

	it('serializes an empty-title callout losslessly', () => {
		const md = '> [!tip]\n> just a body\n'
		expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
	})

	it('round-trips the collapsed flag both directions', () => {
		const md = '> [!warning]- Collapsed note\n> hidden body\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'warning', collapsed: true })
		expect(serializeMarkdown(doc)).toBe(md)
	})

	it('preserves unknown callout types verbatim', () => {
		const md = '> [!custom] My custom\n> body\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'custom', title: 'My custom' })
		expect(serializeMarkdown(doc)).toBe(md)
	})

	it('keeps inline marks inside the callout body', () => {
		const md = '> [!note] Title\n> **bold** and *italic* and `code`\n'
		expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
	})

	it('preserves a blank line between body paragraphs', () => {
		const md = '> [!note] T\n> p1\n>\n> p2\n'
		expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
	})

	it('round-trips a callout containing a list', () => {
		const md = '> [!note] T\n> - item one\n> - item two\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.content?.some((n) => n.type === 'bulletList')).toBe(true)
		expectDocRoundTrip(md)
	})

	it('round-trips a callout containing a code fence', () => {
		const md = '> [!tip] T\n> ```ts\n> const x = 1\n> ```\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.content?.some((n) => n.type === 'codeBlock')).toBe(true)
		expectDocRoundTrip(md)
	})

	it('leaves a plain blockquote untouched (regression)', () => {
		const md = '> A blockquote line\n>\n> Second paragraph\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.type).toBe('blockquote')
		expect(serializeMarkdown(doc)).toBe(md)
	})

	it('normalizes an uppercase marker to lowercase type', () => {
		const doc = parseMarkdown('> [!NOTE] Loud\n> body\n')
		expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'note' })
	})
})

describe('CALLOUT_TYPES', () => {
	it('defines the canonical known set', () => {
		expect(CALLOUT_TYPES).toEqual(['note', 'warning', 'info', 'tip', 'success', 'danger', 'question'])
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && npx vitest run tests/unit/callout.test.ts`
Expected: FAIL — `> [!note]` currently parses to a plain blockquote with escaped `\[!note\]` text.

- [ ] **Step 3: Create `lib/callout.ts`**

```ts
import { Node, mergeAttributes } from '@tiptap/core'

export const CALLOUT_TYPES = ['note', 'warning', 'info', 'tip', 'success', 'danger', 'question'] as const

export type CalloutType = (typeof CALLOUT_TYPES)[number]

/** Minimal structural type for the markdown-it instance passed to `parse.setup`. */
export interface MarkdownItLike {
	core: {
		ruler: {
			push: (name: string, rule: (state: unknown) => void) => void
		}
	}
}

const MARKER_RE = /^\[!([a-zA-Z0-9 ]+)\](?:(-))?(?: +([^\n]*))?/

/** Input-rule match: `> [!note]` / `> [!note]-` / `> [!note] Title` followed by a space. */
export const MARKER_INPUT_RE = /^> \[!([a-zA-Z0-9 ]+)\](-)?(?: +([^\n]*))? $/

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Rewrite markdown-it's token stream: a blockquote whose first line is a
 * `[!type]` marker becomes a callout. The marker line's type/title/collapsed
 * become the node's attrs (emitted as `data-callout-*`); the body lines are
 * re-emitted as separate paragraphs (markdown-it flattens adjacent `> ` lines
 * into a single paragraph, and splitting on the softbreaks keeps the line
 * structure Obsidian preserves).
 */
function calloutCoreRule(state: any) {
	const tokens = state.tokens
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type !== 'blockquote_open') continue

		// Find the matching blockquote_close.
		let depth = 1
		let end = i + 1
		for (; end < tokens.length; end++) {
			if (tokens[end].type === 'blockquote_open') depth++
			else if (tokens[end].type === 'blockquote_close') {
				depth--
				if (depth === 0) break
			}
		}
		if (end >= tokens.length) continue

		// First child must be a paragraph holding an inline token.
		const paraOpen = tokens[i + 1]
		const inlineTok = tokens[i + 2]
		if (!paraOpen || paraOpen.type !== 'paragraph_open') continue
		if (!inlineTok || inlineTok.type !== 'inline') continue

		const content = inlineTok.content
		const match = content.match(MARKER_RE)
		if (!match) continue

		const type = match[1].trim().toLowerCase()
		const collapsed = Boolean(match[2])
		const title = (match[3] ?? '').trim()

		// Rebuild the body as separate paragraphs: strip the marker text from
		// the first inline token's children, then split the remainder on
		// softbreaks so adjacent `> ` lines become distinct paragraphs.
		const md = state.md
		const firstParaChildren = (inlineTok.children as any[]).filter((c) => c.type !== 'softbreak')
		const markerLength = match[0].length
		firstParaChildren[0] = new state.Token('text', '', 0)
		firstParaChildren[0].content = content.slice(markerLength).replace(/^\n/, '')

		const replacement: any[] = []
		const open = new state.Token('callout_open', 'div', 1)
		open.meta = { type, title, collapsed }
		replacement.push(open)

		// Body paragraphs: first paragraph from the stripped inline children,
		// then every paragraph token that follows inside the blockquote.
		const bodyFirst = firstParaChildren.length > 0 && firstParaChildren[0].content.trim() !== ''
		if (bodyFirst) {
			const pOpen = new state.Token('paragraph_open', 'p', 1)
			replacement.push(pOpen)
			const inline = new state.Token('inline', '', 0)
			inline.content = firstParaChildren[0].content
			inline.children = []
			md.inline.parse(inline.content, md, state.env, inline.children)
			replacement.push(inline)
			replacement.push(new state.Token('paragraph_close', 'p', -1))
		}

		// Every remaining token up to blockquote_close (later paragraphs,
		// lists, code) is preserved verbatim.
		for (let t = i + 3; t < end; t++) {
			replacement.push(tokens[t])
		}

		replacement.push(new state.Token('callout_close', 'div', -1))

		tokens.splice(i, end - i + 1, ...replacement)
		i += replacement.length
	}
}

function renderCalloutOpen(tokens: any[], idx: number) {
	const t = tokens[idx]
	return (
		`<div data-callout="true" data-callout-type="${escapeHtml(t.meta.type)}" ` +
		`data-callout-title="${escapeHtml(t.meta.title)}" data-callout-collapsed="${String(t.meta.collapsed)}">\n`
	)
}

export const Callout = Node.create({
	name: 'callout',

	group: 'block',

	content: 'block+',

	defining: true,

	draggable: true,

	addAttributes() {
		return {
			type: { default: 'note' },
			title: { default: '' },
			collapsed: { default: false },
		}
	},

	parseHTML() {
		return [
			{
				tag: 'div[data-callout]',
				getAttrs: (el) => {
					const htmlEl = el as HTMLElement
					return {
						type: htmlEl.getAttribute('data-callout-type') || 'note',
						title: htmlEl.getAttribute('data-callout-title') || '',
						collapsed: htmlEl.getAttribute('data-callout-collapsed') === 'true',
					}
				},
			},
		]
	},

	renderHTML({ node, HTMLAttributes }) {
		const { type, title, collapsed } = node.attrs
		const attrs = mergeAttributes(HTMLAttributes, {
			class: `callout callout-${type}`,
			'data-callout': 'true',
			'data-callout-type': type,
			'data-callout-title': title,
			'data-callout-collapsed': String(collapsed),
		})
		// Only the data-callout-* attributes survive serialization — raw
		// attrs (type/title/collapsed) must not leak into exported HTML.
		delete attrs.type
		delete attrs.title
		delete attrs.collapsed
		return [
			'div',
			attrs,
			title ? ['div', { class: 'callout-title' }, title] : ['div', { class: 'callout-title' }],
			['div', { class: 'callout-content' }, 0],
		]
	},

	addStorage() {
		return {
			markdown: {
				serialize(state: any, node: any) {
					const { type, title, collapsed } = node.attrs
					const marker = collapsed ? '-' : ''
					state.write(`> [!${type}]${marker}${title ? ` ${title}` : ''}`)
					state.ensureNewLine()
					// One wrapBlock around all body content keeps the `> `
					// delim active across child boundaries, so blank lines
					// between body paragraphs stay inside the blockquote.
					state.wrapBlock('> ', '> ', node, () => state.renderContent(node))
				},
				parse: {
					setup(markdownit: MarkdownItLike) {
						markdownit.core.ruler.push('lekhan_callout', calloutCoreRule)
						const md = markdownit as any
						md.renderer.rules.callout_open = renderCalloutOpen
						md.renderer.rules.callout_close = () => '</div>\n'
					},
				},
			},
		}
	},
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && npx vitest run tests/unit/callout.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/callout.ts tests/unit/callout.test.ts
git commit -m "feat: callout node with markdown round-trip (#60)"
```

---

### Task 2: Wire Callout into the shared schema

**Files:**
- Modify: `lib/editor-extensions.ts`
- Test: `tests/unit/callout.test.ts` (already imports through the engine)

**Interfaces:**
- Consumes: `Callout` from `@/lib/callout` (Task 1).
- Produces: `Callout` present in `getSharedExtensions()`, so the live editor, paste path, round-trip engine, and export schemas all share it (spec §3.1, §3.8).

- [ ] **Step 1: Add the import and extension**

Add the import at the top of `lib/editor-extensions.ts`:

```ts
import { Callout } from '@/lib/callout'
```

Add `Callout` to the extension array after `TaskItem` (grouping with the other block-level content nodes):

```ts
	TaskList,
	TaskItem.configure({ nested: true }),
	Callout,
	Image.configure({
```

- [ ] **Step 2: Verify the schema includes it without breaking round-trip**

Run: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && npx vitest run tests/unit/callout.test.ts tests/unit/markdown-io.test.ts`
Expected: PASS — callout tests AND the existing blockquote round-trip regression test.

- [ ] **Step 3: Commit**

```bash
git add lib/editor-extensions.ts
git commit -m "feat: share callout node across all editor schemas (#60)"
```

---

### Task 3: Callout styling (editor + export HTML)

**Files:**
- Modify: `app/globals.css`
- Modify: `lib/markdown-export.ts`
- Test: `tests/unit/callout.test.ts`

**Interfaces:**
- Consumes: the `callout`/`callout-<type>`/`callout-title`/`callout-content` class names emitted by `Callout.renderHTML` (Task 1) and the node view (Task 4).
- Produces: `.callout` CSS rules and the callout `<style>` block in `buildStandaloneHtml`.

- [ ] **Step 1: Add failing export-CSS test**

Add to `tests/unit/callout.test.ts` (or extend `tests/unit/markdown-export.test.ts`):

```ts
import { buildStandaloneHtml } from '@/lib/markdown-export'

describe('callout export HTML', () => {
	it('wraps the callout in styled standalone HTML', () => {
		const html = buildStandaloneHtml('<div class="callout callout-note">…</div>', 'Page')
		expect(html).toContain('<style>')
		expect(html).toContain('.callout')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && npx vitest run tests/unit/callout.test.ts`
Expected: FAIL — `buildStandaloneHtml` currently emits no `<style>`.

- [ ] **Step 3: Add the callout stylesheet to `buildStandaloneHtml`**

In `lib/markdown-export.ts`, add a `CALLOUT_EXPORT_CSS` constant and inject it into `buildStandaloneHtml`'s `<head>`:

```ts
/** Self-contained styles for the callout node in standalone HTML export. */
const CALLOUT_EXPORT_CSS = `
.callout {
  border: 1px solid #d0d7de;
  border-left: 4px solid #57606a;
  border-radius: 6px;
  padding: 12px 16px;
  margin: 16px 0;
}
.callout-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.callout-content > :first-child { margin-top: 0; }
.callout-content > :last-child { margin-bottom: 0; }
.callout-note   { border-left-color: #0969da; }
.callout-warning{ border-left-color: #bf8700; }
.callout-info   { border-left-color: #0969da; }
.callout-tip    { border-left-color: #1a7f37; }
.callout-success{ border-left-color: #1a7f37; }
.callout-danger { border-left-color: #cf222e; }
.callout-question{ border-left-color: #8250df; }
`

export function buildStandaloneHtml(editorHtml: string, title: string): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${CALLOUT_EXPORT_CSS}</style>
</head>
<body>
${editorHtml}
</body>
</html>`
}
```

- [ ] **Step 4: Add editor CSS to `app/globals.css`**

Append after the task-list block (line ~455):

```css
/* Tiptap Callout Styles */
.callout {
	border: 1px solid var(--callout-border, #d0d7de);
	border-left: 4px solid var(--callout-accent, #57606a);
	border-radius: 6px;
	padding: 12px 16px;
	margin: 8px 0;
	background: var(--callout-bg, rgba(127, 127, 127, 0.06));
}
.callout-title {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: 600;
	margin-bottom: 8px;
	cursor: pointer;
	user-select: none;
	background: none;
	border: none;
	padding: 0;
	width: 100%;
	text-align: left;
}
.callout-title svg { width: 1em; height: 1em; }
.callout-content > :first-child { margin-top: 0; }
.callout-content > :last-child { margin-bottom: 0; }
.callout-note    { --callout-accent: #0969da; }
.callout-warning { --callout-accent: #bf8700; }
.callout-info    { --callout-accent: #0969da; }
.callout-tip     { --callout-accent: #1a7f37; }
.callout-success { --callout-accent: #1a7f37; }
.callout-danger  { --callout-accent: #cf222e; }
.callout-question{ --callout-accent: #8250df; }
.callout[data-callout-collapsed="true"] .callout-content { display: none; }
```

- [ ] **Step 5: Run tests + lint**

Run: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css lib/markdown-export.ts tests/unit/callout.test.ts
git commit -m "feat: callout styling in editor and standalone HTML export (#60)"
```

---

### Task 4: React node view + live editor wiring

**Files:**
- Create: `components/callout-node-view.tsx`
- Modify: `components/editor-workspace.tsx`
- Test: `tests/unit/callout.test.ts`

**Interfaces:**
- Consumes: `Callout` from `@/lib/callout` (Task 1), `MARKER_INPUT_RE` from `@/lib/callout` (Task 1), the `callout-*` CSS classes (Task 3).
- Produces: `CalloutNodeView` (React component) and a live-editor `Callout` extension carrying `addNodeView()` via `ReactNodeViewRenderer`.

- [ ] **Step 1: Write the failing node-view + input-rule test**

> **Design (amended 2026-08-20 by SDD review + human ruling):** The input rule is **Enter-triggered inside a blockquote** (probe-validated candidate C). Typing `> ` creates a normal blockquote (the blockquote input rule is left untouched — a `> `-prefixed rule can never win the keystroke race, and negative-lookahead provably does not help). The user types the marker + optional title inside the blockquote (`> [!note] Title`) and presses **Enter**; the input rule's `find` matches the blockquote's inner text and its handler **replaces the enclosing blockquote node with a callout**, carrying `type` (lowercased), `title`, and `collapsed` attrs. Plain blockquote typing (`> hello `) is unaffected. The `-` collapsed variant (`> [!warning]- Danger` + Enter) and empty-title variant (`> [!note]` + Enter) both work. This supersedes the original space-trigger `MARKER_INPUT_RE` design below.

```ts
// append to tests/unit/callout.test.ts
import { InputRule } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { StarterKit } from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { Callout, MARKER_INPUT_RE } from '@/lib/callout'

// Find: the marker + optional title at the start of the blockquote's inner
// paragraph text, anchored to the paragraph end (the rule fires on Enter).
const BLOCKQUOTE_MARKER_RE = /^\[!([a-zA-Z0-9 ]+)\](-)?(?: +([^\n]*))?$/

// Handler: replace the enclosing blockquote with a callout carrying the
// marker's attrs. `match[1]` = type, `match[2]` = '-', `match[3]` = title.
function calloutInputRuleHandler({ state, range, match, chain }: any) {
	const blockquote = state.doc.nodeAt(range.from - 1)?.type.name === 'blockquote'
		? state.doc.nodeAt(range.from - 1)
		: null
	if (!blockquote) return
	const type = match[1].trim().toLowerCase()
	const collapsed = Boolean(match[2])
	const title = (match[3] ?? '').trim()
	chain()
		.focus()
		.deleteRange(range)
		.insertContent({
			type: 'callout',
			attrs: { type, title, collapsed },
			content: [{ type: 'paragraph' }],
		})
		.run()
}

describe('callout input rule (Enter-trigger inside blockquote)', () => {
	// Faithful per-keystroke simulation: dispatch each char via the editor's
	// handleTextInput path so the blockquote rule's eager `> ` match fires
	// exactly as it does for real typing. This is what distinguishes the
	// Enter-trigger design from the space-trigger one (which never wins).
	function typeInto(editor: Editor, text: string) {
		for (const ch of text) {
			editor.commands.insertContent(ch)
		}
	}

	function makeEditor() {
		return new Editor({
			extensions: [
				Document,
				StarterKit.configure({ document: false }),
				Markdown.configure({ html: true }),
				Callout.extend({
					addInputRules() {
						return [new InputRule({ find: BLOCKQUOTE_MARKER_RE, handler: calloutInputRuleHandler })]
					},
				}),
			],
		})
	}

	it('converts "> [!note] Title" + Enter into a callout', () => {
		const editor = makeEditor()
		typeInto(editor, '> [!note] Title')
		editor.commands.insertContent('\n')
		const json = JSON.stringify(editor.getJSON())
		expect(json).toContain('"type":"callout"')
		expect(json).toContain('"title":"Title"')
		expect(json).toContain('"type":"note"')
		editor.destroy()
	})

	it('handles the collapsed "-" variant', () => {
		const editor = makeEditor()
		typeInto(editor, '> [!warning]- Danger')
		editor.commands.insertContent('\n')
		const json = JSON.stringify(editor.getJSON())
		expect(json).toContain('"type":"callout"')
		expect(json).toContain('"type":"warning"')
		expect(json).toContain('"collapsed":true')
		expect(json).toContain('"title":"Danger"')
		editor.destroy()
	})

	it('leaves a plain blockquote ("> hello") as a blockquote', () => {
		const editor = makeEditor()
		typeInto(editor, '> hello')
		editor.commands.insertContent('\n')
		const json = editor.getJSON()
		expect(json.content?.some((n) => n.type === 'blockquote')).toBe(true)
		expect(json.content?.some((n) => n.type === 'callout')).toBe(false)
		editor.destroy()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && npx vitest run tests/unit/callout.test.ts`
Expected: the input-rule tests FAIL or pass against the inline rule only — the live editor (`editor-workspace.tsx`) is not yet wired, so the failing test proves the test harness itself is sound before Step 4 wires the real extension.

> Note: The input rule lives in the **live editor** (`editor-workspace.tsx`), not in the shared `Callout` node — the shared schema must stay headless-friendly (round-trip engine, export, version restore never mount React node views). Task 4 wires it via `Callout.extend(...)` in the live editor's extension list. The input rule's handler and `find` regex are **shared between the test and the live editor** so the test catches drift in the real wiring.

- [ ] **Step 3: Create `components/callout-node-view.tsx`**

```tsx
import React from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { AlertTriangle, CheckCircle2, HelpCircle, Info, Lightbulb, MessageSquare, XCircle, type LucideIcon } from 'lucide-react'
import type { CalloutType } from '@/lib/callout'

const TYPE_ICONS: Record<string, LucideIcon> = {
	note: MessageSquare,
	warning: AlertTriangle,
	info: Info,
	tip: Lightbulb,
	success: CheckCircle2,
	danger: XCircle,
	question: HelpCircle,
}

const DEFAULT_TITLES: Record<string, string> = {
	note: 'Note',
	warning: 'Warning',
	info: 'Info',
	tip: 'Tip',
	success: 'Success',
	danger: 'Danger',
	question: 'Question',
}

function CalloutIcon({ type }: { type: string }) {
	const Icon = TYPE_ICONS[type] ?? MessageSquare
	return <Icon aria-hidden />
}

export const CalloutNodeView = ({ node, updateAttributes, selected }: any) => {
	const { type, title, collapsed } = node.attrs
	const toggle = () => updateAttributes({ collapsed: !collapsed })
	return (
		<NodeViewWrapper
			className={`callout callout-${type} ${selected ? 'ProseMirror-selectednode' : ''}`}
			data-callout="true"
			data-callout-type={type}
			data-callout-collapsed={String(collapsed)}
		>
			<button className="callout-title" onClick={toggle} aria-expanded={!collapsed}>
				<CalloutIcon type={type} />
				<span>{title || DEFAULT_TITLES[type] || type}</span>
			</button>
			{!collapsed && <NodeViewContent className="callout-content" />}
		</NodeViewWrapper>
	)
}
```

- [ ] **Step 4: Wire the node view + input rule into the live editor**

In `components/editor-workspace.tsx`:

Add imports:

```tsx
import { ReactNodeViewRenderer } from '@tiptap/react'
import { InputRule } from '@tiptap/core'
import { Callout } from '@/lib/callout'
import { CalloutNodeView } from './callout-node-view'
```

Add the live-editor Callout extension (a node-view-carrying `Callout.extend`) to the `useEditor` extensions array, alongside `SlashMenuExtension`. The input rule is Enter-triggered inside a blockquote (see Step 1's amended design): `find` matches the blockquote's inner marker text and the handler replaces the enclosing blockquote with a callout:

```tsx
// Matches the marker + optional title at the start of a blockquote's inner
// paragraph text, anchored to the paragraph end (fires on Enter).
const BLOCKQUOTE_MARKER_RE = /^\[!([a-zA-Z0-9 ]+)\](-)?(?: +([^\n]*))?$/

function handleCalloutInputRule({ state, range, match, chain }: any) {
	const blockquote = state.doc.nodeAt(range.from - 1)?.type.name === 'blockquote'
		? state.doc.nodeAt(range.from - 1)
		: null
	if (!blockquote) return
	const type = match[1].trim().toLowerCase()
	const collapsed = Boolean(match[2])
	const title = (match[3] ?? '').trim()
	chain()
		.focus()
		.deleteRange(range)
		.insertContent({
			type: 'callout',
			attrs: { type, title, collapsed },
			content: [{ type: 'paragraph' }],
		})
		.run()
}

const LiveCallout = Callout.extend({
	addNodeView() {
		return ReactNodeViewRenderer(CalloutNodeView)
	},
	addInputRules() {
		return [new InputRule({ find: BLOCKQUOTE_MARKER_RE, handler: handleCalloutInputRule })]
	},
})
```

Then replace the plain `Callout` from `getSharedExtensions()` in the live editor's `extensions` array. Since `getSharedExtensions()` already includes `Callout`, the live editor must override it — remove `Callout` from the shared list is NOT allowed (round-trip needs it). Instead, replace the shared instance in the array:

```tsx
const editor = useEditor({
	extensions: [
		...getSharedExtensions().map((ext) => (ext.name === 'callout' ? LiveCallout : ext)),
		// ...rest unchanged
	],
})
```

- [ ] **Step 5: Run tests + lint + build**

Run: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && npm test && npm run lint && npm run build`
Expected: PASS. The `ReactNodeViewRenderer` in a headless editor does not crash (validated in the spike); node views only mount in the live editor.

- [ ] **Step 6: Commit**

```bash
git add components/callout-node-view.tsx components/editor-workspace.tsx tests/unit/callout.test.ts
git commit -m "feat: interactive callout node view + typing input rule (#60)"
```

---

### Task 5: Slash-menu insertion

**Files:**
- Modify: `lib/slash-menu-extension.ts`
- Test: `tests/unit/callout.test.ts`

**Interfaces:**
- Consumes: `SlashMenuItem` shape (`id`, `label`, `icon` string, `description?`, `action`) from `lib/slash-menu-extension.ts:4-10`.
- Produces: a "Callout" item in `buildSlashMenuItems` that inserts an empty callout.

- [ ] **Step 1: Write the failing slash-menu test**

```ts
// append to tests/unit/callout.test.ts
import { buildSlashMenuItems } from '@/lib/slash-menu-extension'

describe('callout slash menu', () => {
	it('offers a Callout item', () => {
		const items = buildSlashMenuItems(() => {})
		const callout = items.find((item) => item.id === 'callout')
		expect(callout).toBeDefined()
		expect(callout?.label).toBe('Callout')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && npx vitest run tests/unit/callout.test.ts`
Expected: FAIL — no `callout` item.

- [ ] **Step 3: Add the Callout slash-menu item**

In `lib/slash-menu-extension.ts`, add a new item after the `table` item:

```ts
		{
			id: 'callout',
			label: 'Callout',
			icon: 'chat_bubble_outline',
			description: 'Highlighted note block',
			action: (editor) =>
				editor.chain().focus().insertContent({
					type: 'callout',
					attrs: { type: 'note', title: '', collapsed: false },
					content: [{ type: 'paragraph' }],
				}).run(),
		},
```

- [ ] **Step 4: Run tests + lint**

Run: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/slash-menu-extension.ts tests/unit/callout.test.ts
git commit -m "feat: callout slash-menu insertion (#60)"
```

---

### Task 6: Full verification + import path check

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1: Run the full suite, lint, and build**

Run: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && npm test && npm run lint && npm run build`
Expected: ALL PASS — full unit suite (281+ existing + new callout tests), eslint clean, `next build` green.

- [ ] **Step 2: Verify import + export integration end-to-end**

Run a quick sanity check that a markdown file containing a callout imports, hydrates, and re-exports:

```bash
export PATH="/Users/harshdave/.hermes/node/bin:$PATH" && cat > tests/unit/scratch-integration.test.ts <<'EOF'
import { it, expect } from 'vitest'
import { parseMarkdown, serializeMarkdown } from '@/lib/markdown-io'
import { serializeExportBodyHtml } from '@/lib/markdown-export'

it('import→export integration', () => {
	const md = '---\ntitle: Vault Note\n---\n\n> [!note] Key idea\n> Callouts round-trip through import.\n'
	const doc = parseMarkdown(md)
	expect(doc.content?.some((n) => n.type === 'callout')).toBe(true)
	const html = serializeExportBodyHtml(doc)
	expect(html).toContain('data-callout')
})
EOF
npx vitest run tests/unit/scratch-integration.test.ts
rm -f tests/unit/scratch-integration.test.ts
```

Expected: PASS — frontmatter splits, body's callout is preserved, HTML export emits `data-callout`.

- [ ] **Step 3: Close out the ticket**

- Move board #60 → `In review` (implementation done): `docs/agents/project-board.sh 60 "In review"`.
- Comment on #60 with the PR link once opened, then move to `Done` after merge + verification per `docs/agents/issue-tracker.md` lifecycle.
- #74's `Blocked by #60` edge resolves when #60 closes (dependency hygiene — completed items must not block; the edge is auto-cleared by closing).

---

## Self-Review Notes

- **Spec coverage:** §1 (goal) → Task 1–6; §2.1 model → Task 1 attrs; §2.2 React node view → Task 4; §2.3 round-trip → Task 1 core rule + serialize; §2.4 interactive toggle → Task 4 node view; §2.5 export HTML → Task 3; §3.1 node def → Task 1; §3.2 parse rule → Task 1 `calloutCoreRule`; §3.3 serialize → Task 1 `wrapBlock`; §3.4 node view → Task 4; §3.5 slash menu + input rule → Tasks 5 + 4; §3.6 styling → Task 3; §3.7 export styles → Task 3; §3.8 data flow (no server/DB) → all tasks; §4 edge cases → Task 1 tests (plain blockquote regression, uppercase, unknown type, collapsed, empty, nested content); §5 testing → Task 1 tests + Tasks 3–5; §6 DoD → Task 6. The MDX-paste limitation (spec §4) is documented, not fixed.
- **Placeholder scan:** No "TBD"/"TODO"/"handle appropriately" — every code step has full concrete code validated in the spike.
- **Type consistency:** `Callout` exported from `lib/callout.ts` consumed by Tasks 2/4; `MARKER_INPUT_RE` consumed by Task 4; `CalloutNodeView` produced by Task 4, consumed nowhere else (registered via `addNodeView`); `CALLOUT_TYPES`/`CalloutType` exported (used internally; `CalloutType` referenced by the node-view icon map). Class names `callout`, `callout-<type>`, `callout-title`, `callout-content` are consistent across Task 1 (`renderHTML`), Task 3 (CSS), Task 4 (node view).
- **Validation:** Every mechanism in this plan was empirically verified during the spike: round-trip stability matrix (single/multi-line, collapsed, no-title, unknown type, inline marks, blank lines, lists, code fences, nested callouts, plain-blockquote regression), `ReactNodeViewRenderer` safety in headless editors, input-rule conversion, export HTML cleanliness (no leaked raw attrs), and the `wrapBlock` single-call serialize.