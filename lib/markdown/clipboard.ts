import type { JSONContent } from '@tiptap/core'
import { markdownEngine, type PageMeta } from '@/lib/markdown/engine'
import { serializeNotionHtml } from '@/lib/markdown/notion-html'

/**
 * Clipboard copy-out seam (SIL-9 S3). Produces the dual payload written to the
 * system clipboard when a user copies from the editor:
 *
 * - `text` is Obsidian-flavored markdown from the engine's Obsidian profile
 *   (wikilinks, `> [!type]` callouts, inline `#tags`, and — for a whole-Page
 *   copy — YAML frontmatter from Page properties).
 * - `html` is Notion-paste-friendly HTML (real headings, callout-equivalent
 *   blockquotes, lists, tables, genuine links).
 *
 * There is no live sync here — a copy is a one-shot document transfer. Paste
 * targets pick whichever representation they understand.
 */
export interface ClipboardPageMeta {
	title?: string
	tags?: string[]
	properties?: Record<string, unknown>
}

export interface ClipboardPayload {
	text: string
	html: string
}

export interface BuildClipboardPayloadOptions {
	/**
	 * True when the selection covers the whole Page. A whole-Page copy carries
	 * frontmatter; a partial selection is the bare Obsidian-flavored body.
	 */
	wholePage: boolean
}

const INLINE_NODE_TYPES = new Set(['text', 'hardBreak', 'image', 'mention', 'inlineMath'])

/**
 * `doc.cut(from, to)` can leave inline nodes (text, hard breaks, inline atoms)
 * directly under the `doc` node when a selection starts or ends mid-paragraph.
 * The `block+` schema rejects that, so wrap any leaked inline run in a
 * paragraph. Block nodes pass through untouched and whole-Page docs are
 * unchanged.
 */
function normalizeClipboardDoc(doc: JSONContent): JSONContent {
	const content = doc.content ?? []
	const normalized: JSONContent[] = []
	let inlineRun: JSONContent[] = []

	const flushInline = () => {
		if (inlineRun.length > 0) {
			normalized.push({ type: 'paragraph', content: inlineRun })
			inlineRun = []
		}
	}

	for (const node of content) {
		if (node.type && INLINE_NODE_TYPES.has(node.type)) {
			inlineRun.push(node)
		} else {
			flushInline()
			normalized.push(node)
		}
	}
	flushInline()

	return { ...doc, content: normalized }
}

function toPageMeta(meta: ClipboardPageMeta): PageMeta {
	return {
		title: meta.title,
		tags: meta.tags,
		properties: meta.properties ?? {},
	}
}

/**
 * Build both clipboard representations for a Page or selection doc. The engine
 * is the singleton seam for app code (ADR 0005).
 */
export function buildClipboardPayload(
	doc: JSONContent,
	meta: ClipboardPageMeta,
	options: BuildClipboardPayloadOptions,
): ClipboardPayload {
	const normalized = normalizeClipboardDoc(doc)
	const text = options.wholePage
		? markdownEngine.serializeObsidianPage(normalized, toPageMeta(meta))
		: markdownEngine.serializeObsidianBody(normalized)
	const html = serializeNotionHtml(normalized)
	return { text, html }
}

/**
 * Write a payload onto a clipboard event's DataTransfer. Returns false (and
 * writes nothing) when the event has no clipboardData, so callers can fall back
 * to the browser's native copy.
 */
export function writeClipboardPayload(event: ClipboardEvent, payload: ClipboardPayload): boolean {
	const dataTransfer = event.clipboardData
	if (!dataTransfer) return false
	dataTransfer.setData('text/plain', payload.text)
	dataTransfer.setData('text/html', payload.html)
	return true
}
