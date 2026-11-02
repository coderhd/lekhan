import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import {
	appendInboxTag,
	buildLinkedRowText,
	buildRelatedActionText,
	deleteInboxRow,
	findInboxRowAtSelection,
	replaceInboxRowText,
	stripInboxTag,
} from '@/lib/inbox-triage'
import { InboxTriage } from '@/lib/inbox-triage-extension'

const INBOX_DOC = `
	<h2>Inbox</h2>
	<ul>
		<li><p>09:41 Buy milk #inbox</p></li>
		<li><p>10:15 Call Alice #inbox</p></li>
	</ul>
	<h2>Notes</h2>
	<ul>
		<li><p>12:00 random thought #inbox</p></li>
	</ul>
`

let editor: Editor | null = null

afterEach(() => {
	editor?.destroy()
	editor = null
})

function createEditor (onLink = vi.fn(), onTag = vi.fn()) {
	editor = new Editor({
		extensions: [
			StarterKit,
			InboxTriage.configure({ onLink, onTag }),
		],
		content: INBOX_DOC,
	})
	return { editor, onLink, onTag }
}

/** Position immediately before the list item that contains `text`. */
function listItemPos (instance: Editor, text: string): number {
	let found = -1
	instance.state.doc.descendants((node, pos) => {
		if (found !== -1) return false
		if (node.type.name === 'listItem' && node.textContent.includes(text)) {
			found = pos
			return false
		}
		return true
	})
	if (found === -1) throw new Error(`list item not found: ${text}`)
	return found
}

function press (instance: Editor, key: string, init: KeyboardEventInit = {}) {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
	instance.view.dom.dispatchEvent(event)
	return event
}

describe('inbox triage helpers', () => {
	it('removes the #inbox marker and collapses the leftover whitespace', () => {
		expect(stripInboxTag('09:41 Buy milk #inbox')).toBe('09:41 Buy milk')
		expect(stripInboxTag('09:41 #Inbox Buy milk')).toBe('09:41 Buy milk')
		expect(stripInboxTag('09:41 already linked [[Page]]')).toBe('09:41 already linked [[Page]]')
	})

	it('appends one valid tag and keeps #inbox', () => {
		expect(appendInboxTag('09:41 Call Alice #inbox', 'launch')).toBe(
			'09:41 Call Alice #inbox #launch',
		)
		expect(appendInboxTag('09:41 Call Alice #inbox', '#Launch')).toBe(
			'09:41 Call Alice #inbox #launch',
		)
	})

	it('does not duplicate a tag that is already present', () => {
		expect(appendInboxTag('09:41 Call #launch #inbox', 'launch')).toBe('09:41 Call #launch #inbox')
	})

	it('rejects tags outside the existing #tag grammar', () => {
		expect(appendInboxTag('09:41 Call #inbox', 'two words')).toBeNull()
		expect(appendInboxTag('09:41 Call #inbox', '')).toBeNull()
		expect(appendInboxTag('09:41 Call #inbox', '!!!')).toBeNull()
	})

	it('refuses to rewrite a row whose text changed underneath it', () => {
		const { editor } = createEditor()
		editor.commands.setTextSelection(listItemPos(editor, 'Buy milk') + 3)
		const row = findInboxRowAtSelection(editor.state)!

		// A collaborator edits the row between keypress and apply.
		expect(replaceInboxRowText(editor.view, row, '09:41 Buy milk (edited) #inbox')).toBe(true)

		expect(replaceInboxRowText(editor.view, row, '09:41 Buy milk [[Groceries]]')).toBe(false)
		expect(editor.getText()).toContain('09:41 Buy milk (edited) #inbox')
	})

	it('replaces the focused row text without touching its neighbours', () => {
		const { editor } = createEditor()
		editor.commands.setTextSelection(listItemPos(editor, 'Buy milk') + 3)
		const row = findInboxRowAtSelection(editor.state)

		expect(row).not.toBeNull()
		expect(replaceInboxRowText(editor.view, row!, '09:41 Buy milk [[Groceries]]')).toBe(true)
		expect(editor.getText()).toContain('09:41 Buy milk [[Groceries]]')
		expect(editor.getText()).toContain('10:15 Call Alice #inbox')
	})

	it('builds the linked daily row and the target related-action bullet', () => {
		expect(buildLinkedRowText('10:15 Call Alice #inbox', 'Alice Chen')).toBe(
			'10:15 Call Alice [[Alice Chen]]',
		)
		expect(buildRelatedActionText('2026-11-02', '10:15 Call Alice #inbox')).toBe(
			'[[2026-11-02]] 10:15 Call Alice',
		)
	})
})

describe('InboxTriage keyboard plugin', () => {
	it('invokes the link action only when the focused row is an inbox row', () => {
		const { editor, onLink } = createEditor()
		editor.commands.setTextSelection(listItemPos(editor, 'Call Alice') + 3)
		editor.commands.focus()

		press(editor, 'o')

		expect(onLink).toHaveBeenCalledTimes(1)
		expect(onLink.mock.calls[0][0]).toMatchObject({
			pos: expect.any(Number),
			text: expect.stringContaining('Call Alice #inbox'),
		})
	})

	it('fires on a #inbox bullet outside the Inbox heading (count/actions agree)', () => {
		const { editor, onLink, onTag } = createEditor()
		editor.commands.setTextSelection(listItemPos(editor, 'random thought') + 3)
		editor.commands.focus()

		press(editor, 'o')
		press(editor, 't')

		expect(onLink).toHaveBeenCalledTimes(1)
		expect(onTag).toHaveBeenCalledTimes(1)
	})

	it('does not fire with a modifier held (shortcuts keep working)', () => {
		const { editor, onLink } = createEditor()
		editor.commands.setTextSelection(listItemPos(editor, 'Call Alice') + 3)
		editor.commands.focus()

		press(editor, 'o', { metaKey: true })

		expect(onLink).not.toHaveBeenCalled()
	})

	it('does not fire while an IME composition is active', () => {
		const { editor, onLink } = createEditor()
		editor.commands.setTextSelection(listItemPos(editor, 'Call Alice') + 3)
		editor.commands.focus()

		press(editor, 'o', { isComposing: true })

		expect(onLink).not.toHaveBeenCalled()
	})

	it('Delete removes exactly the focused row', () => {		const { editor } = createEditor()
		const row = findInboxRowAtSelection(
			(editor.commands.setTextSelection(listItemPos(editor, 'Buy milk') + 3), editor.state),
		)
		expect(row).not.toBeNull()

		const handled = deleteInboxRow(editor.view, row!)

		expect(handled).toBe(true)
		expect(editor.getText()).not.toContain('Buy milk')
		expect(editor.getText()).toContain('10:15 Call Alice #inbox')
	})

	it('the Delete key deletes the focused row through the plugin', () => {
		const { editor } = createEditor()
		editor.commands.setTextSelection(listItemPos(editor, 'Buy milk') + 3)
		editor.commands.focus()

		const event = press(editor, 'Delete')

		expect(event.defaultPrevented).toBe(true)
		expect(editor.getText()).not.toContain('Buy milk')
		expect(editor.getText()).toContain('Call Alice')
	})

	it('Shift+Delete does not delete the row (cut gesture stays native)', () => {
		const { editor } = createEditor()
		editor.commands.setTextSelection(listItemPos(editor, 'Buy milk') + 3)
		editor.commands.focus()

		const event = press(editor, 'Delete', { shiftKey: true })

		expect(event.defaultPrevented).toBe(false)
		expect(editor.getText()).toContain('Buy milk')
	})

	it('the t key opens the tag action for the focused row', () => {
		const { editor, onTag } = createEditor()
		editor.commands.setTextSelection(listItemPos(editor, 'Buy milk') + 3)
		editor.commands.focus()

		press(editor, 't')

		expect(onTag).toHaveBeenCalledTimes(1)
		expect(onTag.mock.calls[0][0].text).toContain('Buy milk #inbox')
	})

	it('does not fire in a read-only editor (viewers never triage)', () => {
		const { editor, onLink } = createEditor()
		editor.commands.setTextSelection(listItemPos(editor, 'Call Alice') + 3)
		editor.setEditable(false)

		press(editor, 'o')

		expect(onLink).not.toHaveBeenCalled()
	})

	it('does nothing when the selection is not inside any list item', () => {
		const { editor, onLink } = createEditor()
		editor.commands.setTextSelection(1)

		press(editor, 'o')

		expect(onLink).not.toHaveBeenCalled()
	})
})
