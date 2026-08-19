import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { hydrateOnOpen } from '@/lib/import-hydration'

function liveEditor() {
	return new Editor({ extensions: getSharedExtensions() })
}

describe('hydrateOnOpen', () => {
	it('hydrates an empty editor from markdown on first open', () => {
		const editor = liveEditor()
		expect(editor.isEmpty).toBe(true)

		const ok = hydrateOnOpen(editor, '# Title\n\nSome **bold** body\n')
		expect(ok).toBe(true)

		expect(editor.getJSON().content?.[0]?.type).toBe('heading')
		expect(editor.getText()).toContain('Title')
		expect(editor.getText()).toContain('Some bold body')
		editor.destroy()
	})

	it('prepends an empty heading so paragraph-first markdown is preserved, not dropped', () => {
		const editor = liveEditor()
		const ok = hydrateOnOpen(editor, 'Just a paragraph\n')
		expect(ok).toBe(true)

		const doc = editor.getJSON()
		const content = doc.content ?? []
		// The live editor schema requires a leading heading; the content itself
		// must survive (the paragraph follows the title slot).
		expect(content[0]?.type).toBe('heading')
		expect(JSON.stringify(doc)).toContain('Just a paragraph')
		expect(editor.getText()).toContain('Just a paragraph')
		editor.destroy()
	})

	it('leaves a non-empty editor untouched', () => {
		const editor = liveEditor()
		editor.commands.setContent('# Existing\n')
		const before = JSON.stringify(editor.getJSON())

		const ok = hydrateOnOpen(editor, '# New content\n')
		expect(ok).toBe(false)
		expect(JSON.stringify(editor.getJSON())).toBe(before)
		expect(editor.getText()).toContain('Existing')
		expect(editor.getText()).not.toContain('New content')
		editor.destroy()
	})

	it('returns false without touching the editor when there is no initial content', () => {
		const editor = liveEditor()
		expect(hydrateOnOpen(editor, undefined)).toBe(false)
		expect(hydrateOnOpen(editor, '')).toBe(false)
		expect(hydrateOnOpen(editor, '   ')).toBe(false)
		expect(editor.isEmpty).toBe(true)
		editor.destroy()
	})

	it('preserves wikilinks and inline tags as literal text', () => {
		const editor = liveEditor()
		hydrateOnOpen(editor, '# Title\n\nSee [[Alpha]] and #work\n')
		expect(editor.getText()).toContain('[[Alpha]]')
		expect(editor.getText()).toContain('#work')
		editor.destroy()
	})

	it('round-trips the hydrated doc back to the original markdown body', () => {
		const md = '# Title\n\n- a\n- b\n\n> quote\n\n```ts\nconst x = 1\n```\n'
		const editor = liveEditor()
		hydrateOnOpen(editor, md)

		const content = (editor.getJSON().content ?? []) as Array<Record<string, any>>
		// The trailing empty heading is the live editor's TrailingNode slot; the
		// content itself round-trips block-for-block.
		expect(content.map(node => node.type)).toEqual([
			'heading', 'bulletList', 'blockquote', 'codeBlock', 'heading',
		])
		expect(content[0]?.content?.[0]?.text).toBe('Title')
		expect(content[1]?.content?.map((item: any) => item.content?.[0]?.content?.[0]?.text)).toEqual(['a', 'b'])
		expect(content[2]?.content?.[0]?.content?.[0]?.text).toBe('quote')
		expect(content[3]?.content?.[0]?.text).toBe('const x = 1')
		editor.destroy()
	})
})