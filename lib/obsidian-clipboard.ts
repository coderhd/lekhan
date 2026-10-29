import { markdownEngine } from '@/lib/markdown/engine'

export interface ObsidianClipboard {
	/** Non-reserved frontmatter keys, plus `tags` when frontmatter carried them. */
	properties: Record<string, unknown>
	/** Frontmatter tags normalized to a string array (empty when none). */
	tags: string[]
	/** The markdown body with any leading YAML frontmatter removed. */
	body: string
}

// A single leading YAML block delimited by `---` fences. Deliberately strict so
// a body that merely starts with a thematic break (`---`) is not mistaken for
// frontmatter — gray-matter then decides the actual YAML parse.
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/

/**
 * True when the text opens with a well-formed YAML frontmatter fence pair.
 * Used before routing a paste so bodies beginning with a horizontal rule are
 * left untouched.
 */
export function hasObsidianFrontmatter(text: string): boolean {
	return FRONTMATTER_RE.test(text)
}

/**
 * Split an Obsidian-dialect clipboard payload into Page properties, tags, and
 * body. Delegates YAML parsing to the shared markdown engine so paste-in and
 * file import agree on frontmatter semantics. `title` and `tags` are reserved
 * and never leak into properties as themselves; `tags` is re-attached as a
 * property so it indexes like file import does.
 */
export function splitObsidianFrontmatter(text: string): ObsidianClipboard {
	if (typeof text !== 'string' || !hasObsidianFrontmatter(text)) {
		return { properties: {}, tags: [], body: typeof text === 'string' ? text : '' }
	}

	const { data, body } = markdownEngine.parseFrontmatter(text)
	const properties: Record<string, unknown> = { ...data.properties }
	const tags = data.tags ?? []
	if (tags.length > 0) properties.tags = tags

	return { properties, tags, body }
}
