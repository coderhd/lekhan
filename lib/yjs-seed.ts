import * as Y from 'yjs'
import type { JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror'
import { getSharedExtensions } from '@/lib/editor-extensions'

let liveSchema: Schema | null = null

/**
 * The live editor schema (`heading block*`, from `getSharedExtensions()`'s
 * default `CustomDocument`). Built once and reused so a large vault does not
 * pay Editor-construction cost per page. Seeded content MUST be schema-valid
 * for this schema (callers fit via `fitLiveSchema` first).
 */
function getLiveSchema (): Schema {
	if (!liveSchema) {
		const editor = new Editor({ extensions: getSharedExtensions() })
		liveSchema = editor.schema
		editor.destroy()
	}
	return liveSchema
}

/**
 * Base64-encode bytes without a `Buffer` dependency (works in browser and
 * Node 22). Chunked so large image data URLs do not blow the call stack.
 */
export function uint8ArrayToBase64 (bytes: Uint8Array): string {
	let binary = ''
	const chunkSize = 0x8000
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
	}
	return btoa(binary)
}

/** Decode a base64 string back to bytes. */
export function base64ToUint8Array (b64: string): Uint8Array {
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}

/**
 * Seed a Y.Doc's `default` XmlFragment with the given editor content and
 * return the base64-encoded `Y.encodeStateAsUpdate`. `content` must be valid
 * for the live `heading block*` schema (fit it first); a leading heading is
 * required, so a doc that would not open in the live editor is rejected here
 * instead of corrupting the collaborative document. This is the shared
 * headless seeding helper the import pipeline uses to build `contentYjsBase64`.
 */
export function contentToYjsBase64 (content: JSONContent): string {
	const schema = getLiveSchema()
	// `Node.check()` throws when the content does not match the doc's content
	// expression (e.g. a page that does not open with a title heading), so an
	// invalid doc is rejected here instead of corrupting the collaborative one.
	schema.nodeFromJSON(content).check()
	const ydoc = new Y.Doc()
	try {
		prosemirrorJSONToYXmlFragment(schema, content, ydoc.getXmlFragment('default'))
		return uint8ArrayToBase64(Y.encodeStateAsUpdate(ydoc))
	} finally {
		ydoc.destroy()
	}
}

/**
 * Plain text of a doc for `searchable_text` + link/tag extraction: all text
 * nodes joined with newlines. Wikilinks and `#tags` are literal text nodes, so
 * they survive verbatim (the graph index regexes need them); image `src`
 * attributes are not text and are excluded.
 */
export function contentToPlainText (content: JSONContent): string {
	const parts: string[] = []
	const walk = (node: JSONContent): void => {
		if (node.type === 'text') {
			if (node.text) parts.push(node.text)
			return
		}
		if (node.content) {
			for (const child of node.content) walk(child)
		}
	}
	walk(content)
	return parts.join('\n')
}