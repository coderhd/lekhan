import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { deleteInboxRow, findInboxRowAtSelection, type InboxRow } from './inbox-triage'

/**
 * Keyboard triage for the daily page's Inbox section (DN-T3).
 *
 * Keys only fire when the editor selection is inside a `#inbox` list item
 * under an `Inbox` heading, so ordinary typing elsewhere is untouched:
 *   - `o` → open the page picker (link the row)
 *   - `Delete` → delete the row
 *   - `t` → open the tag input
 *
 * The extension owns no UI; `editor-workspace` supplies the callbacks that open
 * the dialog and apply the chosen target/tag.
 */

export interface InboxTriageOptions {
	enabled: boolean
	onLink: (row: InboxRow) => void
	onTag: (row: InboxRow) => void
}

export const InboxTriage = Extension.create<InboxTriageOptions>({
	name: 'inboxTriage',

	addOptions () {
		return {
			enabled: true,
			onLink: () => {},
			onTag: () => {},
		}
	},

	addProseMirrorPlugins () {
		const options = this.options

		return [
			new Plugin({
				props: {
					handleKeyDown (view, event) {
						if (!options.enabled || event.isComposing) return false
						if (!view.editable) return false
						if (event.metaKey || event.ctrlKey || event.altKey) return false

						const row = findInboxRowAtSelection(view.state)
						if (!row) return false

						if (event.key === 'Delete') {
							return deleteInboxRow(view, row)
						}

						if (event.key === 'o') {
							options.onLink(row)
							return true
						}

						if (event.key === 't') {
							options.onTag(row)
							return true
						}

						return false
					},
				},
			}),
		]
	},
})
