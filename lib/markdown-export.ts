import type { JSONContent } from '@tiptap/core'
import { generateHTML } from '@tiptap/core'
import { Mention } from '@tiptap/extension-mention'
import { Document } from '@tiptap/extension-document'
import { assembleMarkdownFile, serializeMarkdown, type PageMeta } from '@/lib/markdown-io'
import { getSharedExtensions } from '@/lib/editor-extensions'

/**
 * The shared schema plus the page-context `Mention` node. Export serializes
 * live-editor docs that can contain mentions, so the schema must know the
 * node or serialization throws/warns "Unknown node type" and the body is
 * dropped. Composed here (not added to `getSharedExtensions`) to keep the
 * round-trip engine's schema seam intact.
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

export function exportFilename(title: string, extension: 'md' | 'mdx' | 'html'): string {
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
 * links, code, …) round-trips into the output; the same body is saved as
 * both `.md` and `.mdx`.
 */
export function serializeExportBodyMarkdown(doc: JSONContent): string {
	return serializeMarkdown(stripAutoHeading(doc), exportExtensions())
}

/**
 * Serialize a page doc's body to HTML for the standalone `.html` export,
 * dropping the placeholder leading heading like the markdown path. Mention
 * nodes need the Mention extension in the schema or `generateHTML` throws
 * "Unknown node type" and no file downloads.
 */
export function serializeExportBodyHtml(doc: JSONContent): string {
	return generateHTML(stripAutoHeading(doc), exportExtensions())
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

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

/**
 * Wrap the editor's rendered HTML in a minimal standalone HTML document so
 * the `.html` export opens directly in a browser or email client.
 */
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
	return assembleMarkdownFile(meta, body)
}
