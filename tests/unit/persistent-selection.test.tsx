import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { PersistentSelection, persistentSelectionPluginKey } from '@/lib/persistent-selection'

describe('PersistentSelection position remapping', () => {
	it('remaps activeRange positions on document changes when selection is collapsed in bot mode', () => {
		const editor = new Editor({
			extensions: [
				StarterKit,
				PersistentSelection,
			],
			content: '<p>Hello world</p>',
		})

		// Select "world" (from pos 7 to 12)
		editor.commands.setTextSelection({ from: 7, to: 12 })
		editor.commands.setBotActive(true)

		let pluginState = persistentSelectionPluginKey.getState(editor.state)
		expect(pluginState?.range).toEqual({ from: 7, to: 12 })

		// Collapse selection to end of doc (pos 12)
		editor.commands.setTextSelection(12)

		// Insert text at start of paragraph (pos 1)
		editor.chain().focus('start').insertContent('Header ').run()

		// Verify that the activeRange positions shifted by 7 characters ("Header " length)
		pluginState = persistentSelectionPluginKey.getState(editor.state)
		expect(pluginState?.range).toEqual({ from: 14, to: 19 })

		editor.destroy()
	})
})
