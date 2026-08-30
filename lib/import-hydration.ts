import type { Editor } from '@tiptap/core'
import { parseMarkdown } from '@/lib/markdown-io'
import { fitLiveSchema } from '@/lib/markdown/engine'

export { fitLiveSchema }

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