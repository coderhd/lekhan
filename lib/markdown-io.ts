import { Editor } from '@tiptap/core'
import type { AnyExtension, JSONContent } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import matter from 'gray-matter'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { insertParsedHtml } from '@/lib/insert-parsed-html'

/**
 * A page's frontmatter, split into the reserved page fields (`title`, `tags`)
 * and everything else. On import `title`/`tags` map to page columns and
 * `page_tags`; `properties` holds the remaining arbitrary metadata.
 */
export interface PageMeta {
	title?: string
	tags?: string[]
	properties: Record<string, unknown>
}

export interface ParsedFrontmatter {
	data: PageMeta
	body: string
}

const RESERVED_KEYS = new Set(['title', 'tags'])

let headlessEditor: Editor | null = null
let customEditor: Editor | null = null

function getHeadlessEditor(extensions?: AnyExtension[]): Editor {
	if (extensions) {
		if (!customEditor) {
			customEditor = new Editor({ extensions })
		}
		return customEditor
	}
	if (!headlessEditor) {
		// A plain `block+` document (not the live editor's `heading block*`)
		// so arbitrary markdown round-trips without the leading-heading
		// constraint.
		headlessEditor = new Editor({ extensions: getSharedExtensions({ document: Document }) })
	}
	return headlessEditor
}

interface MarkdownStorage {
	parser: { parse: (md: string) => string }
	serializer: { serialize: (node: unknown) => string }
}

function getMarkdownStorage(editor: Editor): MarkdownStorage {
	return (editor as unknown as { storage: { markdown: MarkdownStorage } }).storage.markdown
}

/**
 * Parse markdown into a Tiptap doc (JSONContent). The shared schema's
 * markdown parser handles the full supported block set; inline HTML is kept
 * so serialization can emit MDX/SSG-consumable markdown.
 */
export function parseMarkdown(markdown: string): JSONContent {
	const editor = getHeadlessEditor()
	const html = getMarkdownStorage(editor).parser.parse(markdown)
	// The parser output is already HTML; inserting it through `setContent`
	// would re-parse it as markdown and corrupt code blocks that contain
	// blank lines (see lib/insert-parsed-html.ts).
	insertParsedHtml(editor, html, { replaceDocument: true })
	return editor.getJSON()
}

/**
 * Serialize a Tiptap doc (JSONContent) back to markdown. The output is
 * stable: `serializeMarkdown(parseMarkdown(md))` reproduces `md` for
 * canonical input, and re-parsing the output yields the same doc. Pass
 * `extensions` to serialize against a schema that differs from the shared
 * round-trip one (e.g. page-context nodes like mentions, which are absent
 * from `getSharedExtensions`).
 */
export function serializeMarkdown(doc: JSONContent, extensions?: AnyExtension[]): string {
	const editor = getHeadlessEditor(extensions)
	editor.commands.setContent(doc)
	const markdown = getMarkdownStorage(editor).serializer.serialize(editor.state.doc)
	// Canonical trailing newline so `serialize(parse(md))` reproduces
	// well-formed markdown files exactly; an empty doc stays empty.
	return markdown.length > 0 && !markdown.endsWith('\n') ? markdown + '\n' : markdown
}

/**
 * Split frontmatter from a markdown file. `title` and `tags` are pulled out
 * of the raw data into reserved fields (single string tags normalize to an
 * array); every other key becomes a property.
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
	const { data: rawData, content } = matter(markdown)

	const title = typeof rawData.title === 'string' && rawData.title.trim() !== '' ? rawData.title : undefined

	let tags: string[] | undefined
	if (typeof rawData.tags === 'string') {
		tags = [rawData.tags]
	} else if (Array.isArray(rawData.tags)) {
		tags = rawData.tags.filter((tag): tag is string => typeof tag === 'string')
	}
	if (tags && tags.length === 0) {
		tags = undefined
	}

	const properties: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(rawData)) {
		if (!RESERVED_KEYS.has(key)) {
			properties[key] = value
		}
	}

	return { data: { title, tags, properties }, body: content }
}

function pageMetaToData(meta: PageMeta): Record<string, unknown> {
	// Reserved keys never serialize from `properties` — they must come from
	// the top-level `PageMeta` fields. `parseFrontmatter` guarantees this
	// invariant; filtering keeps it true for hand-built metas too.
	const data: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(meta.properties)) {
		if (!RESERVED_KEYS.has(key)) {
			data[key] = value
		}
	}
	if (meta.title !== undefined) {
		data.title = meta.title
	}
	if (meta.tags && meta.tags.length > 0) {
		data.tags = meta.tags
	}
	return data
}

/**
 * Build the YAML block (without `---` fences) for a page's metadata, or
 * `null` when there is nothing to serialize. Reserved keys always win over
 * conflicting properties so `parseFrontmatter` can round-trip cleanly.
 */
export function buildFrontmatter(meta: PageMeta): string | null {
	const data = pageMetaToData(meta)
	if (Object.keys(data).length === 0) {
		return null
	}
	const serialized = matter.stringify('', data)
	return serialized.replace(/^---\n/, '').replace(/\n---\s*$/, '').trimEnd()
}

/**
 * Assemble a full markdown file from a page's metadata and body. With no
 * metadata keys the body passes through untouched.
 */
export function assembleMarkdownFile(meta: PageMeta, body: string): string {
	const data = pageMetaToData(meta)
	if (Object.keys(data).length === 0) {
		return body
	}
	return matter.stringify(body, data)
}
