import { Editor } from '@tiptap/core'
import type { AnyExtension, JSONContent } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { Mention } from '@tiptap/extension-mention'
import type { Schema } from '@tiptap/pm/model'
import matter from 'gray-matter'
import * as Y from 'yjs'
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { insertParsedHtml } from '@/lib/insert-parsed-html'

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

// ---------------------------------------------------------------------------
// Engine — deep module, per-instance Map, no globals
// ---------------------------------------------------------------------------

function pageMetaToData(meta: PageMeta): Record<string, unknown> {
	const data: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(meta.properties)) {
		if (!RESERVED_KEYS.has(key)) data[key] = value
	}
	if (meta.title !== undefined) data.title = meta.title
	if (meta.tags && meta.tags.length > 0) data.tags = meta.tags
	return data
}

export function fitLiveSchema(content: JSONContent): JSONContent {
	const nodes = (content.content ?? []).filter((node, index, all) => {
		if (index !== all.length - 1 || node.type !== 'paragraph') return true
		const children = node.content ?? []
		if (children.length === 0) return false
		if (children.some((c) => c.type !== 'text')) return true
		const text = children.map((c) => ('text' in c ? (c.text ?? '') : '')).join('')
		return text.trim() !== ''
	})
	const startsWithHeading = nodes.length > 0 && nodes[0].type === 'heading'
	if (startsWithHeading) return { ...content, content: nodes }
	return { ...content, content: [{ type: 'heading', attrs: { level: 1 }, content: [] }, ...nodes] }
}

export function schemaKey(extensions?: AnyExtension[]): string {
	if (!extensions || extensions.length === 0) return 'roundTrip'
	// Must distinguish order + config + Document content expression, not just sorted names.
	// Two arrays with same names but different Document (`heading block*` vs `block+`) or
	// Mention `HTMLAttributes` would otherwise collide and reuse an incompatible Editor schema.
	// Note: JSON.stringify drops function-valued options (e.g. Mention renderText, Placeholder placeholder);
	// such configs still collide — acceptable today as no caller varies them, and a caller-provided key would be needed for full distinction.
	return extensions
		.map(e => {
			const opts = e.options ? JSON.stringify(e.options) : '{}'
			const content = (e as unknown as { config?: { content?: string } }).config?.content ?? ''
			return `${e.name}::${opts}::${content}`
		})
		.join('||')
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = ''
	const chunkSize = 0x8000
	for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
	return btoa(binary)
}

export function base64ToUint8Array(b64: string): Uint8Array {
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

export class MarkdownEngine {
	private editors = new Map<string, Editor>()
	private liveSchema: Schema | null = null

	private getEditor(extensions?: AnyExtension[]): Editor {
		const key = schemaKey(extensions)
		let ed = this.editors.get(key)
		if (ed) return ed
		if (extensions) {
			ed = new Editor({ extensions })
		} else {
			// plain block+ for round-trip
			ed = new Editor({ extensions: getSharedExtensions({ document: Document }) })
		}
		this.editors.set(key, ed)
		return ed
	}

	private getLiveSchema(): Schema {
		if (this.liveSchema) return this.liveSchema
		const ed = new Editor({ extensions: getSharedExtensions() })
		this.liveSchema = ed.schema
		ed.destroy()
		return this.liveSchema
	}

	private getMarkdownStorage(editor: Editor): { parser: { parse: (md: string) => string }; serializer: { serialize: (node: unknown) => string } } {
		return (editor as unknown as { storage: { markdown: { parser: { parse: (md: string) => string }; serializer: { serialize: (node: unknown) => string } } } }).storage.markdown
	}

	// -- Page frontmatter (re-exported seam, no globals) --

	parseFrontmatter(markdown: string): ParsedFrontmatter {
		const { data: rawData, content } = matter(markdown)
		const title = typeof rawData.title === 'string' && rawData.title.trim() !== '' ? rawData.title : undefined
		let tags: string[] | undefined
		if (typeof rawData.tags === 'string') tags = [rawData.tags]
		else if (Array.isArray(rawData.tags)) tags = rawData.tags.filter((t): t is string => typeof t === 'string')
		if (tags && tags.length === 0) tags = undefined
		const properties: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(rawData)) if (!RESERVED_KEYS.has(k)) properties[k] = v
		return { data: { title, tags, properties }, body: content }
	}

	buildFrontmatter(meta: PageMeta): string | null {
		const data = pageMetaToData(meta)
		if (Object.keys(data).length === 0) return null
		const serialized = matter.stringify('', data)
		return serialized.replace(/^---\n/, '').replace(/\n---\s*$/, '').trimEnd()
	}

	assembleMarkdownFile(meta: PageMeta, body: string): string {
		const data = pageMetaToData(meta)
		if (Object.keys(data).length === 0) return body
		return matter.stringify(body, data)
	}

	// -- Round-trip Page content --

	parse(markdown: string): JSONContent {
		const editor = this.getEditor()
		const html = this.getMarkdownStorage(editor).parser.parse(markdown)
		insertParsedHtml(editor, html, { replaceDocument: true })
		return editor.getJSON()
	}

	serialize(doc: JSONContent, extensions?: AnyExtension[]): string {
		const editor = this.getEditor(extensions)
		editor.commands.setContent(doc)
		const md = this.getMarkdownStorage(editor).serializer.serialize(editor.state.doc)
		return md.length > 0 && !md.endsWith('\n') ? md + '\n' : md
	}

	// Export helper — Mention-aware, used by lib/markdown-export.ts
	serializeExport(doc: JSONContent): string {
		const exts = [...getSharedExtensions({ document: Document }), Mention.configure({ HTMLAttributes: { class: 'mention' } })]
		return this.serialize(doc, exts)
	}

	// -- Yjs / plain text (Page graph) --

	seedToYjsBase64(content: JSONContent): string {
		const fitted = fitLiveSchema(content)
		const schema = this.getLiveSchema()
		schema.nodeFromJSON(fitted).check()
		const ydoc = new Y.Doc()
		try {
			prosemirrorJSONToYXmlFragment(schema, fitted, ydoc.getXmlFragment('default'))
			const bytes = Y.encodeStateAsUpdate(ydoc)
			return uint8ArrayToBase64(bytes)
		} finally {
			ydoc.destroy()
		}
	}

	plainText(content: JSONContent): string {
		const parts: string[] = []
		const walk = (node: JSONContent): void => {
			if (node.type === 'text') {
				if (node.text) parts.push(node.text)
				return
			}
			if (node.content) for (const c of node.content) walk(c)
		}
		walk(content)
		return parts.join('\n')
	}

	destroy(): void {
		for (const ed of this.editors.values()) ed.destroy()
		this.editors.clear()
		this.liveSchema = null
	}
}

// Singleton for app code (headless, not live editor). Tests should `new MarkdownEngine()` per test.
export const markdownEngine = new MarkdownEngine()
