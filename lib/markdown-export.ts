import type { JSONContent } from '@tiptap/core'
import { generateHTML } from '@tiptap/core'
import { assembleMarkdownFile, serializeMarkdown, type PageMeta } from '@/lib/markdown-io'
import { getSharedExtensions } from '@/lib/editor-extensions'

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

export function markdownExportFilename(title: string): string {
	return exportFilename(title, 'md')
}

export function mdxExportFilename(title: string): string {
	return exportFilename(title, 'mdx')
}

export function htmlExportFilename(title: string): string {
	return exportFilename(title, 'html')
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
 * Strip the live editor's auto-filled leading heading (the `heading block*`
 * placeholder that shows "Untitled Document") from a doc. It is not page
 * content, and without stripping it an empty page would export a stray `# `
 * or `<h1></h1>` as its first element. Non-empty headings are the user's
 * real first block and are kept.
 */
export function stripAutoHeading(doc: JSONContent): JSONContent {
	const content = [...(doc.content ?? [])]
	if (content[0]?.type === 'heading' && !(content[0].content ?? []).length) {
		content.shift()
	}
	return { ...doc, content }
}

/**
 * Serialize a page doc for export to markdown, dropping the placeholder
 * leading heading. HTML the editor represents as marks/nodes (color spans,
 * links, code, …) round-trips into the output; the same body is saved as
 * both `.md` and `.mdx`.
 */
export function serializeExportBody(doc: JSONContent): string {
	return serializeMarkdown(stripAutoHeading(doc))
}

/**
 * Serialize a page doc's body to HTML for the standalone `.html` export,
 * dropping the placeholder leading heading like the markdown path.
 */
export function serializeExportBodyHtml(doc: JSONContent): string {
	return generateHTML(stripAutoHeading(doc), getSharedExtensions())
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

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
