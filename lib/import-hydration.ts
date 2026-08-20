import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { parseMarkdown } from '@/lib/markdown-io'

/**
 * Normalize a parsed markdown doc for the live editor's `heading block*`
 * schema (a page doc opens with a title heading). When the imported body
 * does not start with a heading, an empty heading is prepended as the title
 * slot so the content is preserved instead of being coerced/dropped by the
 * stricter schema.
 */
export function fitLiveSchema(content: JSONContent): JSONContent {
	const nodes = (content.content ?? []).filter((node, index, all) => {
		// Trailing empty paragraphs are artifacts of the body's final newline —
		// the TrailingNode extension already appends the editor's own empty slot.
		if (index !== all.length - 1 || node.type !== 'paragraph') return true
		const text = (node.content ?? []).map(child => ('text' in child ? child.text ?? '' : '')).join('')
		return text.trim() !== ''
	})
	const startsWithHeading = nodes.length > 0 && nodes[0].type === 'heading'
	if (startsWithHeading) {
		return { ...content, content: nodes }
	}
	return {
		...content,
		content: [{ type: 'heading', attrs: { level: 1 }, content: [] }, ...nodes],
	}
}

/**
 * Hydrate an editor from an imported markdown body on first open. Only runs
 * when the editor doc is empty (a page the user already has content in is
 * never clobbered). Returns `true` when content was inserted. The payload is
 * consumed by the caller (see `consumePendingImport`); calling this again
 * after hydration is a no-op because the doc is no longer empty.
 */
export function hydrateOnOpen (editor: Editor, initialContent: string | null | undefined): boolean {
	if (!initialContent || initialContent.trim() === '') {
		return false
	}
	if (!editor.isEmpty) {
		return false
	}
	const content = fitLiveSchema(parseMarkdown(initialContent))
	editor.commands.setContent(content)
	return true
}