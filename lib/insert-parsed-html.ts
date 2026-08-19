import { Editor } from '@tiptap/core'
import { DOMParser } from '@tiptap/pm/model'

/**
 * Insert HTML that has already been produced by the markdown parser (e.g.
 * `storage.markdown.parser.parse`) into an editor, bypassing the
 * tiptap-markdown `setContent`/`insertContentAt` command overrides.
 *
 * Those overrides unconditionally re-parse their input as markdown. Feeding
 * already-HTML through markdown-it a second time corrupts `<pre><code>` blocks
 * that contain blank lines: markdown-it ends an HTML block at the first blank
 * line, so the trailing code is reinterpreted as indented markdown and the
 * closing `</code></pre>` tags leak into the text, splitting one code block
 * into several. Parsing the HTML directly with the editor's schema keeps it
 * intact.
 */
export function insertParsedHtml(
	editor: Editor,
	html: string,
	opts: { replaceAll?: boolean } = {},
): void {
	const element = document.createElement('div')
	element.innerHTML = html
	const parser = DOMParser.fromSchema(editor.schema)
	const { tr } = editor.state

	if (opts.replaceAll) {
		tr.replaceWith(0, tr.doc.content.size, parser.parse(element))
	} else {
		const fragment = parser.parseSlice(element, { preserveWhitespace: 'full' }).content
		let { from, to } = editor.state.selection
		let isOnlyBlockContent = true
		fragment.forEach((node) => {
			if (!node.isBlock) isOnlyBlockContent = false
		})
		// Mirror tiptap's insertContentAt: pasting block content into an
		// empty text block replaces the whole block instead of nesting.
		if (from === to && isOnlyBlockContent) {
			const { parent } = tr.doc.resolve(from)
			if (parent.isTextblock && !parent.type.spec.code && !parent.childCount) {
				from -= 1
				to += 1
			}
		}
		tr.replaceWith(from, to, fragment)
	}

	editor.view.dispatch(tr)
}
