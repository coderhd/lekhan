import { describe, it, expect, vi, beforeAll } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { prosemirrorJSONToYDoc, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import type { Schema } from '@tiptap/pm/model'
import { getSharedExtensions } from '@/lib/editor-extensions'
import {
	appendCaptureBlock,
	appendCaptureBlockToYDoc,
	buildCaptureText,
	CaptureError,
	type CaptureConnection,
} from '@/lib/quick-capture'

const NOW = new Date(2026, 10, 2, 9, 41) // 2026-11-02 09:41 local

let schema: Schema

beforeAll(() => {
	const editor = new Editor({ extensions: getSharedExtensions(), editable: false })
	schema = editor.schema
	editor.destroy()
})

/**
 * Read the *CRDT* content, not a reader editor's document: a fresh editor bound
 * to a Yjs doc appends an artifact trailing heading, so assertions target the
 * fragment itself (what collaborators actually receive).
 */
function readYDoc (ydoc: Y.Doc) {
	return yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment('default'), schema).toJSON()
}

function seed (ydoc: Y.Doc, content: any[]) {
	const seeded = prosemirrorJSONToYDoc(schema, { type: 'doc', content }, 'default')
	Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(seeded))
	seeded.destroy()
}

/** One capture, exactly like production: a Yjs transaction on the page doc. */
function capture (ydoc: Y.Doc, text: string, now = NOW, pageTitle = '2026-11-02') {
	return appendCaptureBlockToYDoc(ydoc, { pageTitle, text, now })
}

function inboxBullets (json: any): string[] {
	const bullets: string[] = []
	for (const node of json.content ?? []) {
		if (node.type !== 'bulletList') continue
		for (const item of node.content ?? []) {
			const paragraph = item.content?.[0]
			if (paragraph?.type === 'paragraph') {
				bullets.push((paragraph.content ?? []).map((child: any) => child.text ?? '').join(''))
			}
		}
	}
	return bullets
}

describe('buildCaptureText', () => {
	it('prefixes the local time and appends the #inbox marker', () => {
		expect(buildCaptureText('Buy milk', NOW)).toBe('09:41 Buy milk #inbox')
	})

	it('keeps #tag and [[wikilink]] grammar untouched', () => {
		expect(buildCaptureText('Call [[Alice Chen]] about #launch', NOW))
			.toBe('09:41 Call [[Alice Chen]] about #launch #inbox')
	})

	it('does not duplicate an #inbox tag the user typed', () => {
		expect(buildCaptureText('Fix flaky test #inbox', NOW)).toBe('09:41 Fix flaky test #inbox')
		expect(buildCaptureText('#Inbox quick thought', NOW)).toBe('09:41 #Inbox quick thought')
	})

	it('collapses newlines and runs of whitespace into one bullet', () => {
		expect(buildCaptureText('  first line\n\n second\tline  ', NOW)).toBe('09:41 first line second line #inbox')
	})

	it('pads single-digit times', () => {
		expect(buildCaptureText('early', new Date(2026, 10, 2, 7, 5))).toBe('07:05 early #inbox')
	})

	it('rejects an empty capture', () => {
		expect(buildCaptureText('   \n ', NOW)).toBeNull()
	})
})

describe('appendCaptureBlockToYDoc', () => {
	it('seeds the title and Inbox section on an empty page and appends a timestamped bullet', () => {
		const ydoc = new Y.Doc()

		expect(capture(ydoc, 'Buy milk')).toBe('09:41 Buy milk #inbox')

		const json = readYDoc(ydoc)
		expect(json.content.map((node: any) => node.type)).toEqual(['heading', 'heading', 'bulletList'])
		expect(json.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
		expect(json.content[0].content?.[0]?.text).toBe('2026-11-02')
		expect(json.content[1]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
		expect(json.content[1].content?.[0]?.text).toBe('Inbox')
		expect(inboxBullets(json)).toEqual(['09:41 Buy milk #inbox'])
		ydoc.destroy()
	})

	it('appends a second capture below the first in the same list', () => {
		const ydoc = new Y.Doc()

		capture(ydoc, 'First')
		capture(ydoc, 'Second', new Date(2026, 10, 2, 10, 15))

		const json = readYDoc(ydoc)
		// No extra empty heading accumulates from the headless editors.
		expect(json.content.filter((node: any) => node.type === 'heading')).toHaveLength(2)
		expect(json.content.filter((node: any) => node.type === 'bulletList')).toHaveLength(1)
		expect(inboxBullets(json)).toEqual(['09:41 First #inbox', '10:15 Second #inbox'])
		ydoc.destroy()
	})

	it('extends an existing Inbox section instead of duplicating it, leaving other sections alone', () => {
		const ydoc = new Y.Doc()
		seed(ydoc, [
			{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '2026-11-02' }] },
			{
				type: 'bulletList',
				content: [{
					type: 'listItem',
					content: [{
						type: 'paragraph',
						content: [{ type: 'text', text: 'earlier capture' }],
					}],
				}],
			},
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Inbox' }] },
			{
				type: 'bulletList',
				content: [{
					type: 'listItem',
					content: [{
						type: 'paragraph',
						content: [{ type: 'text', text: 'existing inbox item' }],
					}],
				}],
			},
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
			{ type: 'paragraph', content: [{ type: 'text', text: 'not a capture target' }] },
		])

		capture(ydoc, 'New capture')

		const json = readYDoc(ydoc)
		const headings = json.content.filter((node: any) => node.type === 'heading')
		expect(headings.map((node: any) => node.textContent ?? node.content?.[0]?.text)).toEqual([
			'2026-11-02',
			'Inbox',
			'Notes',
		])
		expect(inboxBullets(json)).toEqual(['earlier capture', 'existing inbox item', '09:41 New capture #inbox'])
		// The trailing Notes section is untouched.
		expect(json.content.at(-1)).toMatchObject({ type: 'paragraph' })
		ydoc.destroy()
	})

	it('creates an Inbox section when the page has content but none yet', () => {
		const ydoc = new Y.Doc()
		seed(ydoc, [
			{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Project log' }] },
			{ type: 'paragraph', content: [{ type: 'text', text: 'random thoughts' }] },
		])

		capture(ydoc, 'Call [[Alice]]', NOW, 'Project log')

		const json = readYDoc(ydoc)
		expect(json.content.map((node: any) => node.type)).toEqual([
			'heading',
			'paragraph',
			'heading',
			'bulletList',
		])
		expect(json.content[2].content?.[0]?.text).toBe('Inbox')
		expect(inboxBullets(json)).toEqual(['09:41 Call [[Alice]] #inbox'])
		ydoc.destroy()
	})

	it('does not seed a duplicate title heading on a page that already has content', () => {
		const ydoc = new Y.Doc()
		seed(ydoc, [
			{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Existing title' }] },
		])

		capture(ydoc, 'note', NOW, 'Existing title')

		const json = readYDoc(ydoc)
		expect(json.content.filter((node: any) => node.type === 'heading')).toHaveLength(2)
		expect(inboxBullets(json)).toEqual(['09:41 note #inbox'])
		ydoc.destroy()
	})

	it('renders in a live collaborative editor bound to the same Y.Doc', () => {
		const ydoc = new Y.Doc()
		capture(ydoc, 'Buy milk')
		capture(ydoc, 'Call [[Alice]] about #launch', new Date(2026, 10, 2, 10, 15))

		// This is the same binding the workspace editor uses (Collaboration over
		// the page's Y.Doc), so the capture is visible to collaborators live.
		const editor = new Editor({
			extensions: [...getSharedExtensions(), Collaboration.configure({ document: ydoc })],
			editable: false,
		})
		try {
			const text = editor.getText()
			expect(text).toContain('Inbox')
			expect(text).toContain('09:41 Buy milk #inbox')
			expect(text).toContain('10:15 Call [[Alice]] about #launch #inbox')
			const json = editor.getJSON()
			expect(inboxBullets(json)).toEqual([
				'09:41 Buy milk #inbox',
				'10:15 Call [[Alice]] about #launch #inbox',
			])
		} finally {
			editor.destroy()
		}
		ydoc.destroy()
	})
})

describe('appendCaptureBlock (CRDT append orchestrator)', () => {
	const baseArgs = {
		pageId: 'page-1',
		pageTitle: '2026-11-02',
		token: 'token-1',
		text: 'Buy milk',
		now: NOW,
	}

	it('waits for sync, appends into the synced Y.Doc, flushes and tears down', async () => {
		const flush = vi.fn().mockResolvedValue(undefined)
		const destroy = vi.fn()
		let syncedDoc: Y.Doc | null = null
		let xmlAtFlush = ''

		const connect = (doc: Y.Doc): CaptureConnection => {
			syncedDoc = doc
			return {
				synced: Promise.resolve(),
				flush: async () => {
					xmlAtFlush = doc.getXmlFragment('default').toString()
					await flush()
				},
				destroy,
			}
		}

		const result = await appendCaptureBlock({ ...baseArgs, connect })

		expect(result.bulletText).toBe('09:41 Buy milk #inbox')
		expect(syncedDoc).not.toBeNull()
		expect(xmlAtFlush).toContain('Buy milk #inbox')
		expect(xmlAtFlush).toContain('Inbox')
		expect(flush).toHaveBeenCalledTimes(1)
		expect(destroy).toHaveBeenCalledTimes(1)
	})

	it('rejects an empty capture before connecting', async () => {
		const connect = vi.fn()
		await expect(appendCaptureBlock({ ...baseArgs, text: '  ', connect })).rejects.toMatchObject({
			name: 'CaptureError',
			code: 'empty',
		})
		expect(connect).not.toHaveBeenCalled()
	})

	it('tears the connection down when sync fails', async () => {
		const destroy = vi.fn()
		const connect = (): CaptureConnection => ({
			synced: Promise.reject(new CaptureError('forbidden', 'No access to that page')),
			flush: vi.fn(),
			destroy,
		})

		await expect(appendCaptureBlock({ ...baseArgs, connect })).rejects.toMatchObject({
			name: 'CaptureError',
			code: 'forbidden',
		})
		expect(destroy).toHaveBeenCalledTimes(1)
	})

	it('times out a sync that never completes and still tears down', async () => {
		const destroy = vi.fn()
		const connect = (): CaptureConnection => ({
			synced: new Promise(() => {}),
			flush: vi.fn(),
			destroy,
		})

		await expect(
			appendCaptureBlock({ ...baseArgs, connect, syncTimeoutMs: 20 }),
		).rejects.toMatchObject({ name: 'CaptureError', code: 'timeout' })
		expect(destroy).toHaveBeenCalledTimes(1)
	})
})
