import { describe, expect, it, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { findInboxRowAtSelection, replaceInboxRowText, type InboxRow } from '@/lib/inbox-triage'
import { InboxTriageError, linkInboxRow, tagInboxRow } from '@/lib/inbox-triage-actions'

const INBOX_DOC = `
	<h2>Inbox</h2>
	<ul>
		<li><p>09:41 Buy milk #inbox</p></li>
		<li><p>10:15 Call Alice #inbox</p></li>
	</ul>
`

let editor: Editor | null = null

afterEach(() => {
	editor?.destroy()
	editor = null
})

function createEditor () {
	editor = new Editor({ extensions: [StarterKit], content: INBOX_DOC })
	return editor
}

function rowFor (instance: Editor, text: string): InboxRow {
	let pos = -1
	instance.state.doc.descendants((node, nodePos) => {
		if (pos !== -1) return false
		if (node.type.name === 'listItem' && node.textContent.includes(text)) {
			pos = nodePos
			return false
		}
		return true
	})
	if (pos === -1) throw new Error(`row not found: ${text}`)
	instance.commands.setTextSelection(pos + 3)
	const row = findInboxRowAtSelection(instance.state)
	if (!row) throw new Error('no focused inbox row')
	return row
}

describe('linkInboxRow', () => {
	it('links the row and appends a back-reference to the target section', async () => {
		const instance = createEditor()
		const row = rowFor(instance, 'Call Alice')
		const append = vi.fn().mockResolvedValue({ bulletText: 'ok' })

		await linkInboxRow({
			view: instance.view,
			row,
			target: { id: 'target-1', title: 'Alice Chen' },
			dailyPageTitle: '2026-11-02',
			token: 'token-1',
			append,
		})

		expect(append).toHaveBeenCalledWith({
			pageId: 'target-1',
			token: 'token-1',
			section: 'Related actions',
			text: '[[2026-11-02]] 10:15 Call Alice',
		})
		expect(instance.getText()).toContain('10:15 Call Alice [[Alice Chen]]')
		expect(instance.getText()).not.toContain('Call Alice #inbox')
	})

	it('refuses a read-only target before writing anything', async () => {
		const instance = createEditor()
		const row = rowFor(instance, 'Call Alice')
		const append = vi.fn()

		await expect(linkInboxRow({
			view: instance.view,
			row,
			target: { id: 'target-1', title: 'Alice Chen' },
			dailyPageTitle: '2026-11-02',
			token: 'token-1',
			ensureCanEdit: async () => false,
			append,
		})).rejects.toMatchObject({ code: 'forbidden' })

		expect(append).not.toHaveBeenCalled()
		expect(instance.getText()).toContain('10:15 Call Alice #inbox')
	})

	it('refuses a stale row instead of rewriting a different capture', async () => {
		const instance = createEditor()
		const row = rowFor(instance, 'Call Alice')
		const append = vi.fn()

		// A collaborator edits the row while the dialog is open.
		expect(replaceInboxRowText(instance.view, row, '10:15 Call Alice (edited) #inbox')).toBe(true)

		await expect(linkInboxRow({
			view: instance.view,
			row,
			target: { id: 'target-1', title: 'Alice Chen' },
			dailyPageTitle: '2026-11-02',
			token: 'token-1',
			append,
		})).rejects.toBeInstanceOf(InboxTriageError)

		expect(append).not.toHaveBeenCalled()
		expect(instance.getText()).toContain('Call Alice (edited) #inbox')
	})

	it('restores the pending row when the target append fails', async () => {
		const instance = createEditor()
		const row = rowFor(instance, 'Call Alice')
		const append = vi.fn().mockRejectedValue(new Error('offline'))

		await expect(linkInboxRow({
			view: instance.view,
			row,
			target: { id: 'target-1', title: 'Alice Chen' },
			dailyPageTitle: '2026-11-02',
			token: 'token-1',
			append,
		})).rejects.toThrow('offline')

		expect(instance.getText()).toContain('10:15 Call Alice #inbox')
		expect(instance.getText()).not.toContain('[[Alice Chen]]')
	})
})

describe('tagInboxRow', () => {
	it('adds the tag and keeps the row pending', () => {
		const instance = createEditor()
		const row = rowFor(instance, 'Buy milk')

		const result = tagInboxRow({ view: instance.view, row, tag: 'grocery' })

		expect(result.changed).toBe(true)
		expect(instance.getText()).toContain('09:41 Buy milk #inbox #grocery')
	})

	it('reports an existing tag without rewriting the row', () => {
		const instance = createEditor()
		const row = rowFor(instance, 'Buy milk')

		const result = tagInboxRow({ view: instance.view, row, tag: 'INBOX' })

		expect(result.changed).toBe(false)
		expect(instance.getText()).toContain('09:41 Buy milk #inbox')
	})

	it('rejects an invalid tag', () => {
		const instance = createEditor()
		const row = rowFor(instance, 'Buy milk')

		try {
			tagInboxRow({ view: instance.view, row, tag: 'two words' })
			expect.unreachable('expected an invalid-tag error')
		} catch (error) {
			expect(error).toMatchObject({ code: 'invalid-tag' })
		}
	})

	it('rejects a stale row', () => {
		const instance = createEditor()
		const row = rowFor(instance, 'Buy milk')
		replaceInboxRowText(instance.view, row, '09:41 Buy milk (edited) #inbox')

		try {
			tagInboxRow({ view: instance.view, row, tag: 'grocery' })
			expect.unreachable('expected a stale error')
		} catch (error) {
			expect(error).toMatchObject({ code: 'stale' })
		}
		expect(instance.getText()).toContain('Buy milk (edited) #inbox')
	})
})
