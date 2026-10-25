import type { JSONContent } from '@tiptap/core'
import { generateHTML } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { Mention } from '@tiptap/extension-mention'
import { markdownEngine } from '@/lib/markdown/engine'
import type { PageMeta } from '@/lib/markdown/engine'
import { getSharedExtensions } from '@/lib/editor-extensions'

/**
 * The shared schema plus the page-context `Mention` node. Export serializes
 * live-editor docs that can contain mentions, so the schema must know the
 * node or serialization throws/warns "Unknown node type" and the body is
 * dropped. Composed here (not added to `getSharedExtensions`) to keep the
 * round-trip engine's schema seam intact.
 * Keep in sync with MarkdownEngine.serializeExport() in lib/markdown/engine.ts:156
 * (md path) — both compose [...getSharedExtensions({document: Document}), Mention] inline.
 * If one changes (e.g., HTMLAttributes), update the other to avoid .md/.html divergence.
 */
const exportExtensions = (): ReturnType<typeof getSharedExtensions> => [
	...getSharedExtensions({ document: Document }),
	Mention.configure({ HTMLAttributes: { class: 'mention' } }),
]

/**
 * Slugify a page title into a safe filename fragment: lowercase, and every
 * run of non-alphanumeric characters collapses to a single hyphen. Unicode
 * letters, digits, and combining marks are kept so non-Latin titles (e.g.
 * Devanagari with vowel marks) keep their name instead of falling back to
 * `untitled.md`.
 */
export function slugifyTitle(title: string): string {
	return title
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
}

export function exportFilename(title: string, extension: 'md' | 'html'): string {
	const slug = slugifyTitle(title)
	return `${slug || 'untitled'}.${extension}`
}

/**
 * Resolve the tags to serialize into frontmatter. `page_tags` is the source
 * of truth; `properties.tags` is its round-trip mirror and only a fallback.
 */
export function resolveTags(pageTags: string[], properties: Record<string, unknown>): string[] {
	const clean = pageTags.filter((tag) => tag.trim() !== '')
	if (clean.length > 0) {
		return clean
	}
	const mirror = properties.tags
	if (Array.isArray(mirror)) {
		return mirror.filter((tag): tag is string => typeof tag === 'string')
	}
	return []
}

/**
 * Strip the live editor's auto-filled empty headings (the `heading block*`
 * placeholder that shows "Untitled Document") from a doc. They are not page
 * content: without stripping, an empty page would export a stray `# ` as its
 * first element and any replacement of a doc that doesn't end in a heading
 * (e.g. markdown import hydration) would export a trailing `# ` line. Non-empty
 * headings are the user's real blocks and are kept.
 */
export function stripAutoHeading(doc: JSONContent): JSONContent {
	const content = [...(doc.content ?? [])]
	if (content[0]?.type === 'heading' && !(content[0].content ?? []).length) {
		content.shift()
	}
	const last = content[content.length - 1]
	if (content.length > 1 && last?.type === 'heading' && !(last.content ?? []).length) {
		content.pop()
	}
	return { ...doc, content }
}

/**
 * Serialize a page doc for export to markdown, dropping the placeholder
 * leading heading. HTML the editor represents as marks/nodes (color spans,
 * links, code, …) round-trips into the output; saved as `.md`.
 */
export function serializeExportBodyMarkdown(doc: JSONContent): string {
	return markdownEngine.serializeExport(stripAutoHeading(doc))
}

/**
 * Serialize a page doc's body to HTML for the standalone `.html` export,
 * dropping the placeholder leading heading like the markdown path. Mention
 * nodes need the Mention extension in the schema or `generateHTML` throws
 * "Unknown node type" and no file downloads.
 */
export function serializeExportBodyHtml(doc: JSONContent): string {
	return wrapTablesForScroll(staticizeTaskCheckboxes(generateHTML(stripAutoHeading(doc), exportExtensions())))
}

/**
 * Wide tables must scroll sideways without breaking their column grid.
 * `display: block` on the `<table>` itself turns each of its `thead`/`tbody`/
 * `tfoot` sections into an independent table, so headers and body rows can
 * compute different column widths. Wrapping the whole table in a scroll
 * container keeps one table model; only the wrapper scrolls.
 *
 * Depth-aware so a table nested inside a cell is not split mid-element.
 */
function wrapTablesForScroll(html: string): string {
	const out: string[] = []
	const token = /<table\b[^>]*>|<\/table>/g
	let depth = 0
	let last = 0
	let match: RegExpExecArray | null
	while ((match = token.exec(html)) !== null) {
		if (match[0].startsWith('</')) {
			depth--
			if (depth === 0) {
				out.push(html.slice(last, match.index + match[0].length), '</div>')
				last = match.index + match[0].length
			}
		} else {
			if (depth === 0) {
				out.push(html.slice(last, match.index), '<div class="table-scroll">')
				last = match.index
			}
			depth++
		}
	}
	// Unbalanced markup: leave it untouched rather than emit a broken wrapper.
	if (depth !== 0) return html
	out.push(html.slice(last))
	return out.join('')
}

/**
 * Task items serialize as live checkbox inputs. In a static export a click or
 * Space press would toggle the DOM without persisting, and the bare input has
 * no accessible name. Disable it and label its state so the visual checkmark
 * remains but the control cannot mislead.
 */
function staticizeTaskCheckboxes(html: string): string {
	return html.replace(/<input type="checkbox"([^>]*)>/g, (_match, attrs: string) => {
		const checked = /\bchecked(?:="[^"]*")?/.test(attrs)
		const label = checked ? 'Completed' : 'Not completed'
		return `<input type="checkbox"${attrs} disabled aria-label="${label}">`
	})
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/**
 * Self-contained editorial styles for the standalone HTML export. Covers the
 * block nodes the editor emits (headings, paragraphs, lists, task lists, code,
 * blockquotes, tables, images, rules) plus the callout node's per-type accents
 * and collapsed state. Uses only system fonts and inline rules — the exported
 * file makes no external requests and works offline.
 */
const STANDALONE_EXPORT_CSS = `
:root {
  color-scheme: light;
  --export-text: #1f2328;
  --export-muted: #59636e;
  --export-bg: #ffffff;
  --export-surface: #f6f8fa;
  --export-border: #d1d9e0;
  --export-link: #0969da;
}

* { box-sizing: border-box; }

html { background: var(--export-bg); }

body {
  max-width: 46rem;
  margin: 0 auto;
  padding: 3rem 1.25rem 4rem;
  background: var(--export-bg);
  color: var(--export-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  font-size: 16px;
  line-height: 1.65;
  overflow-wrap: break-word;
  -webkit-text-size-adjust: 100%;
}

h1, h2, h3, h4, h5, h6 {
  margin: 1.8em 0 0.6em;
  font-weight: 600;
  line-height: 1.25;
}
h1 { font-size: 2rem; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.25rem; }
h4 { font-size: 1rem; }
h5 { font-size: 0.9375rem; }
h6 { font-size: 0.875rem; color: var(--export-muted); }

body > :first-child { margin-top: 0; }

p { margin: 0 0 1em; }

ul, ol { margin: 0 0 1em; padding-left: 1.5rem; }
li { margin: 0.25em 0; }
li > p { margin-bottom: 0.35em; }

a { color: var(--export-link); text-decoration: underline; text-underline-offset: 2px; }
strong { font-weight: 600; }
mark { background: #fff8c5; color: inherit; padding: 0 0.1em; }
img { max-width: 100%; height: auto; border-radius: 4px; }

hr { border: 0; border-top: 1px solid var(--export-border); margin: 2rem 0; }

blockquote {
  margin: 0 0 1em;
  padding: 0.25rem 0 0.25rem 1rem;
  border-left: 4px solid var(--export-border);
  color: var(--export-muted);
  font-style: italic;
}
blockquote > :last-child { margin-bottom: 0; }

code, kbd, samp {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.875em;
}
:not(pre) > code {
  padding: 0.15em 0.35em;
  border-radius: 4px;
  background: var(--export-surface);
}
pre {
  margin: 0 0 1.2em;
  padding: 1rem;
  overflow-x: auto;
  border: 1px solid var(--export-border);
  border-radius: 8px;
  background: var(--export-surface);
  line-height: 1.5;
}
pre code {
  padding: 0;
  border: 0;
  background: none;
  font-size: 0.875rem;
  white-space: pre;
}

.table-scroll {
  margin: 0 0 1.2em;
  overflow-x: auto;
}
table {
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  font-size: 0.95em;
}
th, td { padding: 0.5rem 0.75rem; border: 1px solid var(--export-border); text-align: left; vertical-align: top; }
th { background: var(--export-surface); font-weight: 600; }
th > p, td > p { margin: 0; }

ul[data-type="taskList"] { padding-left: 0; list-style: none; }
/* Direct children only: an ordinary list nested inside a task item must keep
   normal list-item layout (markers, spacing) instead of inheriting the flex row. */
ul[data-type="taskList"] > li {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin: 0.35rem 0;
}
ul[data-type="taskList"] > li > label {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  margin-top: 0.25em;
}
ul[data-type="taskList"] > li > div { flex: 1 1 auto; min-width: 0; }
ul[data-type="taskList"] > li > div > p { margin: 0; }
ul[data-type="taskList"] input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
  margin: 0;
  accent-color: var(--export-link);
  /* Static export: clicking would toggle the DOM without persisting. */
  pointer-events: none;
  cursor: default;
}
ul[data-type="taskList"] input[type="checkbox"]:disabled { opacity: 1; }
ul[data-type="taskList"] ul[data-type="taskList"] { margin-top: 0.25rem; padding-left: 1.25rem; }

.mention {
  padding: 0.1em 0.35em;
  border: 1px solid rgba(255, 154, 0, 0.3);
  border-radius: 0.375rem;
  background: rgba(255, 154, 0, 0.15);
  color: #b45309;
  font-size: 0.875em;
  font-weight: 500;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.callout {
  --callout-accent: #57606a;
  --callout-surface: #f6f8fa;
  margin: 1.25rem 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--export-border);
  border-left: 4px solid var(--callout-accent);
  border-radius: 6px;
  background: var(--callout-surface);
}
.callout-title {
  margin-bottom: 0.35rem;
  color: var(--callout-accent);
  font-weight: 600;
}
.callout-title:empty { display: none; }
.callout-content > :first-child { margin-top: 0; }
.callout-content > :last-child { margin-bottom: 0; }
.callout-content p { margin-bottom: 0.5em; }

.callout-note, .callout-info { --callout-accent: #0969da; --callout-surface: #eef6ff; }
/* Darker amber than the editor accent so the title clears AA contrast on its tint. */
.callout-warning { --callout-accent: #9a6700; --callout-surface: #fff8e5; }
.callout-tip, .callout-success { --callout-accent: #1a7f37; --callout-surface: #edf9f0; }
.callout-danger { --callout-accent: #cf222e; --callout-surface: #fff0ef; }
.callout-question { --callout-accent: #8250df; --callout-surface: #f7f2ff; }
.callout[data-callout-collapsed="true"] .callout-content { display: none; }

@media (max-width: 600px) {
  body { padding: 1.5rem 1rem 3rem; }
  h1 { font-size: 1.75rem; }
  h2 { font-size: 1.35rem; }
}

@media print {
  body { max-width: none; padding: 0; }
  h1, h2, h3 { break-after: avoid; }
  .callout, pre, table, blockquote { break-inside: avoid; }
  /* Paper cannot expand a collapsed callout — show its body in print. */
  .callout[data-callout-collapsed="true"] .callout-content { display: block; }
  a { color: inherit; text-decoration: underline; }
}
`

/**
 * Wrap the editor's rendered HTML in a self-contained standalone HTML
 * document so the `.html` export opens directly in a browser or email client
 * with the editor's block nodes styled.
 */
export function buildStandaloneHtml(editorHtml: string, title: string): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STANDALONE_EXPORT_CSS}</style>
</head>
<body>
${editorHtml}
</body>
</html>`
}

/**
 * Assemble a page's markdown export: YAML frontmatter (title, properties,
 * tags) followed by the serialized body. Reserved keys never leak from
 * `properties` — the engine's frontmatter builder enforces that.
 */
export function buildMarkdownExport(options: {
	title: string
	properties: Record<string, unknown>
	pageTags: string[]
	body: string
}): string {
	const { title, properties, pageTags, body } = options
	const tags = resolveTags(pageTags, properties)
	const meta: PageMeta = { title, properties }
	if (tags.length > 0) {
		meta.tags = tags
	}
	return markdownEngine.assembleMarkdownFile(meta, body)
}
