import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { contentToYjsBase64, contentToPlainText, uint8ArrayToBase64, base64ToUint8Array } from '@/lib/yjs-seed'

describe('contentToYjsBase64', () => {
	it('seeds a Y.Doc whose default fragment renders in a bound live editor', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
			],
		}
		const b64 = contentToYjsBase64(content)
		expect(typeof b64).toBe('string')
		expect(b64.length).toBeGreaterThan(0)

		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(b64))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		expect(editor.getHTML()).toContain('Title')
		expect(editor.getHTML()).toContain('Hello world')
		editor.destroy()
	})

	it('seeds callout content (live schema) so it renders as a callout', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'T' }] },
				{
					type: 'callout',
					attrs: { type: 'note', title: 'Tip', collapsed: false },
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }],
				},
			],
		}
		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(contentToYjsBase64(content)))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		expect(editor.getHTML()).toContain('data-callout')
		expect(editor.getHTML()).toContain('Tip')
		editor.destroy()
	})

	it('auto-fits paragraph-first content for the live heading-block* schema (Page)', () => {
		// Engine now fits live schema internally — paragraph-first is valid and gets an empty title heading.
		const b64 = contentToYjsBase64({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] })
		expect(typeof b64).toBe('string')
		expect(b64.length).toBeGreaterThan(0)
	})

	it('rejects truly invalid content for the live Page schema', () => {
		expect(() =>
			contentToYjsBase64({ type: 'doc', content: [{ type: 'unknownNode', content: [] }] } as unknown as never)
		).toThrow()
	})
})

describe('contentToPlainText', () => {
	it('concatenates text, preserving wikilinks and tags literally', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'See [[Alpha]] and #work' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
			],
		}
		const text = contentToPlainText(content)
		expect(text).toContain('[[Alpha]]')
		expect(text).toContain('#work')
		expect(text).toContain('second')
	})

	it('excludes image node src from plain text', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
				{ type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } },
			],
		}
		expect(contentToPlainText(content)).toBe('before')
	})
})

describe('base64 helpers', () => {
	it('round-trips arbitrary bytes', () => {
		const bytes = new Uint8Array([0, 1, 2, 250, 255])
		expect(base64ToUint8Array(uint8ArrayToBase64(bytes))).toEqual(bytes)
	})
})