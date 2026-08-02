import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { PersistentSelection } from '../../lib/persistent-selection'

describe('PersistentSelection Extension', () => {
	it('does not apply persistent selection when bot is inactive', () => {
		const editor = new Editor({
			extensions: [StarterKit, PersistentSelection],
			content: '<p>Hello world</p>',
		})

		editor.commands.setTextSelection({ from: 1, to: 6 })
		const storage = editor.storage.persistentSelection
		expect(storage.activeRange).toBeNull()

		editor.destroy()
	})

	it('applies and updates persistent selection when bot is active', () => {
		const editor = new Editor({
			extensions: [StarterKit, PersistentSelection],
			content: '<p>Hello world</p>',
		})

		editor.commands.setTextSelection({ from: 1, to: 6 })
		editor.commands.setBotActive(true)

		const storage = editor.storage.persistentSelection
		expect(storage.activeRange).toEqual({ from: 1, to: 6 })

		// Change selection while bot is active
		editor.commands.setTextSelection({ from: 7, to: 12 })
		expect(storage.activeRange).toEqual({ from: 7, to: 12 })

		// Deactivate bot
		editor.commands.setBotActive(false)
		expect(storage.activeRange).toBeNull()

		editor.destroy()
	})
})
