import { assembleMarkdownFile, type PageMeta } from '@/lib/markdown-io'

/**
 * Slugify a page title into a safe filename fragment: lowercase, and every
 * run of non-alphanumeric characters collapses to a single hyphen.
 */
export function slugifyTitle(title: string): string {
	return title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
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
	if (pageTags.length > 0) {
		return pageTags
	}
	const mirror = properties.tags
	if (Array.isArray(mirror)) {
		return mirror.filter((tag): tag is string => typeof tag === 'string')
	}
	return []
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
