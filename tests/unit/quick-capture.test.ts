const wsProviderSpy = vi.hoisted(() => vi.fn())

vi.mock('y-websocket', () => {
	class FakeWebsocketProvider {
		synced = false
		ws: { readyState: number; bufferedAmount: number } | null = { readyState: 1, bufferedAmount: 0 }
		destroy = vi.fn()
		private handlers = new Map<string, Set<(...args: any[]) => void>>()

		constructor (url: string, room: string, doc: Y.Doc, options: any) {
			wsProviderSpy(url, room, doc, options)
			setTimeout(() => this.emit('sync', true), 0)
		}

		on (event: string, handler: (...args: any[]) => void) {
			if (!this.handlers.has(event)) this.handlers.set(event, new Set())
			this.handlers.get(event)!.add(handler)
		}

		off (event: string, handler: (...args: any[]) => void) {
			this.handlers.get(event)?.delete(handler)
		}

		emit (event: string, ...args: any[]) {
			for (const handler of this.handlers.get(event) ?? []) handler(...args)
		}
	}

	return { WebsocketProvider: FakeWebsocketProvider }
})

import { describe, it, expect, vi, beforeAll } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { prosemirrorJSONToYDoc, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import type { Schema } from '@tiptap/pm/model'
import { getSharedExtensions } from '@/lib/editor-extensions'
import {
	appendBulletToSectionToYDoc,
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
function capture (ydoc: Y.Doc, text: string, now = NOW) {
	return appendCaptureBlockToYDoc(ydoc, { text, now })
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

	it('treats a longer #inbox-prefixed tag as a different tag', () => {
		expect(buildCaptureText('Fix #inbox-2026', NOW)).toBe('09:41 Fix #inbox-2026 #inbox')
		expect(buildCaptureText('Fix #inbox/foo', NOW)).toBe('09:41 Fix #inbox/foo #inbox')
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

describe('appendBulletToSectionToYDoc', () => {
	it('creates the named section and seeds an empty leading heading on an empty page', () => {
		const ydoc = new Y.Doc()

		expect(appendBulletToSectionToYDoc(ydoc, {
			section: 'Related actions',
			text: '[[2026-11-02]] Call Alice',
		})).toBe(true)

		const json = readYDoc(ydoc)
		expect(json.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
		expect(json.content[1].content?.[0]?.text).toBe('Related actions')
		expect(inboxBullets(json)).toEqual(['[[2026-11-02]] Call Alice'])
	})

	it('extends an existing section without duplicating the heading', () => {
		const ydoc = new Y.Doc()
		seed(ydoc, [
			{ type: 'heading', attrs: { level: 1 } },
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Inbox' }] },
			{
				type: 'bulletList',
				content: [
					{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '09:41 Keep #inbox' }] }] },
				],
			},
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Related actions' }] },
			{
				type: 'bulletList',
				content: [
					{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '[[2026-11-01]] Earlier' }] }] },
				],
			},
		])

		appendBulletToSectionToYDoc(ydoc, {
			section: 'Related actions',
			text: '[[2026-11-02]] Call Alice',
		})

		const json = readYDoc(ydoc)
		expect(json.content.filter((node: any) => node.type === 'heading' && node.content?.[0]?.text === 'Related actions')).toHaveLength(1)
		expect(inboxBullets(json)).toEqual([
			'09:41 Keep #inbox',
			'[[2026-11-01]] Earlier',
			'[[2026-11-02]] Call Alice',
		])
	})

	it('rejects empty text so no empty bullet is written', () => {
		const ydoc = new Y.Doc()

		expect(appendBulletToSectionToYDoc(ydoc, { section: 'Related actions', text: '   ' })).toBe(false)
		expect(ydoc.getXmlFragment('default').length).toBe(0)
	})

	it('is idempotent for the same bullet text', () => {
		const ydoc = new Y.Doc()

		appendBulletToSectionToYDoc(ydoc, { section: 'Related actions', text: '[[2026-11-02]] Call Alice' })
		appendBulletToSectionToYDoc(ydoc, { section: 'Related actions', text: '[[2026-11-02]] Call Alice' })

		expect(inboxBullets(readYDoc(ydoc))).toEqual(['[[2026-11-02]] Call Alice'])
	})

	it('does not treat a deeper H3 section as the H2 target', () => {
		const ydoc = new Y.Doc()
		seed(ydoc, [
			{ type: 'heading', attrs: { level: 1 } },
			{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Inbox' }] },
		])

		expect(appendBulletToSectionToYDoc(ydoc, { section: 'Inbox', text: '09:41 New #inbox' })).toBe(true)

		const json = readYDoc(ydoc)
		const inboxHeadings = json.content.filter(
			(node: any) => node.type === 'heading' && node.content?.[0]?.text === 'Inbox',
		)
		expect(inboxHeadings).toHaveLength(2)
		expect(inboxHeadings[1].attrs.level).toBe(2)
		expect(inboxBullets(json)).toEqual(['09:41 New #inbox'])
	})
})

describe('appendCaptureBlockToYDoc', () => {
	it('seeds an empty leading heading and Inbox section on an empty page, then appends a timestamped bullet', () => {
		const ydoc = new Y.Doc()

		expect(capture(ydoc, 'Buy milk')).toBe('09:41 Buy milk #inbox')

		const json = readYDoc(ydoc)
		expect(json.content.map((node: any) => node.type)).toEqual(['heading', 'heading', 'bulletList'])
		expect(json.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
		// EMPTY_PAGE_DOC convention: the page title lives in `pages.title` and
		// frontmatter, never as a duplicated body heading.
		expect(json.content[0].content ?? []).toHaveLength(0)
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

		capture(ydoc, 'Call [[Alice]]', NOW)

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

		capture(ydoc, 'note', NOW)

		const json = readYDoc(ydoc)
		expect(json.content.filter((node: any) => node.type === 'heading')).toHaveLength(2)
		expect(inboxBullets(json)).toEqual(['09:41 note #inbox'])
		ydoc.destroy()
	})

	it('positions a new Inbox list correctly when the fragment has non-element children', () => {
		const ydoc = new Y.Doc()
		seed(ydoc, [
			{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '2026-11-02' }] },
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Inbox' }] },
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
			{ type: 'paragraph', content: [{ type: 'text', text: 'notes body' }] },
		])

		// y-prosemirror never emits a top-level XmlText, but the fragment type
		// allows it. Insert one so the element-index/raw-index spaces diverge.
		const fragment = ydoc.getXmlFragment('default')
		const stray = new Y.XmlText()
		stray.insert(0, 'stray raw text')
		const notesIndex = fragment.toArray().findIndex(
			node => node instanceof Y.XmlElement && node.nodeName === 'heading' &&
				node.toString().includes('Notes'),
		)
		fragment.insert(notesIndex, [stray])

		capture(ydoc, 'landed below the stray text')

		const shape = fragment.toArray().map(node => node instanceof Y.XmlElement ? node.nodeName : 'rawText')
		expect(shape).toEqual(['heading', 'heading', 'rawText', 'bulletList', 'heading', 'paragraph'])
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

	it('connects to the page room over y-websocket with the editor token params', async () => {
		wsProviderSpy.mockClear()

		const result = await appendCaptureBlock({
			pageId: 'page-42',
			token: 'jwt-token',
			text: 'From the real connector',
			now: NOW,
			wsUrl: 'wss://sync.example',
		})

		expect(result.bulletText).toBe('09:41 From the real connector #inbox')
		const [url, room, doc, options] = wsProviderSpy.mock.calls[0]
		expect(url).toBe('wss://sync.example')
		expect(room).toBe('page-42')
		expect(doc).toBeInstanceOf(Y.Doc)
		expect(options).toEqual({
			params: { token: 'jwt-token', documentId: 'page-42' },
			connect: true,
		})
		expect(doc.getXmlFragment('default').toString()).toContain('From the real connector #inbox')
	})
})
