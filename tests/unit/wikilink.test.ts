import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import {
	parseWikilinksInText,
	normalizeWikilinkTarget,
	createWikilinkDecorations,
	Wikilink,
	wikilinkPluginKey,
} from '@/lib/wikilink'

describe('wikilink parsing and normalization', () => {
	it('matches plain wikilinks', () => {
		const text = 'Check out [[Obsidian Import]] for details.'
		const matches = parseWikilinksInText(text)

		expect(matches).toHaveLength(1)
		expect(matches[0]).toEqual({
			raw: '[[Obsidian Import]]',
			target: 'Obsidian Import',
			alias: null,
			from: 10,
			to: 29,
		})
	})

	it('matches aliased wikilinks', () => {
		const text = 'Read the [[API Reference|docs]] here.'
		const matches = parseWikilinksInText(text)

		expect(matches).toHaveLength(1)
		expect(matches[0]).toEqual({
			raw: '[[API Reference|docs]]',
			target: 'API Reference',
			alias: 'docs',
			from: 9,
			to: 31,
		})
	})

	it('matches multiple wikilinks in single string', () => {
		const text = 'Links: [[First Note]], [[Second Note|2nd]], and [[Third Note]].'
		const matches = parseWikilinksInText(text)

		expect(matches).toHaveLength(3)
		expect(matches[0].target).toBe('First Note')
		expect(matches[1].target).toBe('Second Note')
		expect(matches[1].alias).toBe('2nd')
		expect(matches[2].target).toBe('Third Note')
	})

	it('normalizes target titles for case and whitespace insensitive matching', () => {
		expect(normalizeWikilinkTarget('  Obsidian   Import  ')).toBe('obsidian import')
		expect(normalizeWikilinkTarget('Project Roadmap')).toBe('project roadmap')
		expect(normalizeWikilinkTarget('PROject   ROADMAP')).toBe('project roadmap')
	})

	it('ignores empty brackets or non-wikilink brackets', () => {
		expect(parseWikilinksInText('[[]]')).toHaveLength(0)
		expect(parseWikilinksInText('[[   ]]')).toHaveLength(0)
		expect(parseWikilinksInText('[Regular markdown link](https://example.com)')).toHaveLength(0)
		expect(parseWikilinksInText('Array index [0]')).toHaveLength(0)
	})

	it('creates resolved decorations for known workspace pages and unresolved for missing', () => {
		const schema = new Schema({
			nodes: {
				doc: { content: 'block+' },
				paragraph: { group: 'block', content: 'text*' },
				text: { group: 'inline' },
			},
		})

		const doc = schema.node('doc', null, [
			schema.node('paragraph', null, [
				schema.text('Here is [[Existing Page]] and [[Missing Note]].'),
			]),
		])

		const pagesMap = new Map([
			['existing page', { id: 'page-123', title: 'Existing Page' }],
		])

		const decoSet = createWikilinkDecorations(doc, pagesMap)
		const decos = decoSet.find()

		expect(decos).toHaveLength(2)

		// Resolved decoration
		expect(decos[0].from).toBe(9)
		expect(decos[0].to).toBe(26)
		expect((decos[0] as any).type.attrs['data-wikilink-resolved']).toBe('true')
		expect((decos[0] as any).type.attrs['data-wikilink-page-id']).toBe('page-123')
		expect((decos[0] as any).type.attrs.class).toContain('wikilink-resolved')

		// Unresolved decoration
		expect(decos[1].from).toBe(31)
		expect(decos[1].to).toBe(47)
		expect((decos[1] as any).type.attrs['data-wikilink-resolved']).toBe('false')
		expect((decos[1] as any).type.attrs.class).toContain('wikilink-unresolved')
	})

	it('dynamically updates decorations when workspace pages change in Tiptap editor', () => {
		const editor = new Editor({
			extensions: [
				StarterKit,
				Wikilink.configure({
					workspacePages: [],
				}),
			],
			content: '<p>Link to [[My Target]] page.</p>',
		})

		const pluginStateBefore = wikilinkPluginKey.getState(editor.state)
		const decosBefore = pluginStateBefore?.find() || []
		expect(decosBefore).toHaveLength(1)
		expect(decosBefore[0].type.attrs['data-wikilink-resolved']).toBe('false')

		// Add target page to workspace
		editor.commands.setWorkspacePages([{ id: 'page-999', title: 'My Target' }])

		const pluginStateAfter = wikilinkPluginKey.getState(editor.state)
		const decosAfter = pluginStateAfter?.find() || []
		expect(decosAfter).toHaveLength(1)
		expect(decosAfter[0].type.attrs['data-wikilink-resolved']).toBe('true')
		expect(decosAfter[0].type.attrs['data-wikilink-page-id']).toBe('page-999')

		// Verify underlying text is preserved as literal [[My Target]]
		expect(editor.getText()).toContain('Link to [[My Target]] page.')

		editor.destroy()
	})
})
