import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Markdown } from 'tiptap-markdown'
import { Document } from '@tiptap/extension-document'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'

const CustomDocument = Document.extend({
	content: 'heading block*',
})

describe('Table content persistence with Yjs', () => {
	it('persists table content across Yjs doc reload', () => {
		const ydoc1 = new Y.Doc()

		const editor1 = new Editor({
			extensions: [
				CustomDocument,
				StarterKit.configure({ document: false }),
				Table.configure({ resizable: true }),
				TableRow,
				TableHeader,
				TableCell,
				Markdown.configure({
					html: true,
					transformPastedText: true,
					transformCopiedText: true,
				}),
				Collaboration.configure({
					document: ydoc1,
				}),
			],
		})

		// Set initial heading content
		editor1.commands.setContent('<h1>Test Document</h1><p>Paragraph before table</p>')
		// Move cursor to end and insert table
		editor1.commands.focus('end')
		editor1.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })

		// Type text into table cells
		const html1 = editor1.getHTML()
		expect(html1).toContain('<table')

		// Encode Yjs binary state (simulating saving to Supabase or IndexedDB)
		const stateUpdate = Y.encodeStateAsUpdate(ydoc1)

		// Create a second Yjs doc and apply the binary update (simulating reopening document)
		const ydoc2 = new Y.Doc()
		Y.applyUpdate(ydoc2, stateUpdate)

		const editor2 = new Editor({
			extensions: [
				CustomDocument,
				StarterKit.configure({ document: false }),
				Table.configure({ resizable: true }),
				TableRow,
				TableHeader,
				TableCell,
				Markdown.configure({
					html: true,
					transformPastedText: true,
					transformCopiedText: true,
				}),
				Collaboration.configure({
					document: ydoc2,
				}),
			],
		})

		const html2 = editor2.getHTML()
		expect(html2).toContain('<table')

		editor1.destroy()
		editor2.destroy()
	})
})
