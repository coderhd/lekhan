import type { JSONContent } from '@tiptap/core'
import { assembleMarkdownFile, serializeMarkdown, type PageMeta } from '@/lib/markdown-io'

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

export function markdownExportFilename(title: string): string {
	const slug = slugifyTitle(title)
	return `${slug || 'untitled'}.md`
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
 * Serialize a page doc for export, dropping the live editor's auto-filled
 * leading heading (the `heading block*` placeholder that shows "Untitled
 * Document"). It is not page content, and without stripping it an empty page
 * would export a stray `# ` as its first body line. Non-empty headings are
 * the user's real first block and are kept.
 */
export function serializeExportBody(doc: JSONContent): string {
	const content = [...(doc.content ?? [])]
	if (content[0]?.type === 'heading' && !(content[0].content ?? []).length) {
		content.shift()
	}
	return serializeMarkdown({ ...doc, content })
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
