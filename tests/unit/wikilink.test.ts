import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import {
	parseWikilinksInText,
	normalizeWikilinkTarget,
	createWikilinkDecorations,
	buildWikilinkSuggestions,
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

	it('triggers onCreatePage with target when unresolved wikilink element is clicked', () => {
		let createdTitle: string | null = null
		let currentWorkspaceId: string | null = null

		// Simulate stable ref pattern used in editor-workspace
		const handleCreate = (title: string) => {
			if (currentWorkspaceId) {
				createdTitle = `${currentWorkspaceId}:${title}`
			}
		}

		const editor = new Editor({
			extensions: [
				StarterKit,
				Wikilink.configure({
					workspacePages: [],
					onCreatePage: (title) => handleCreate(title),
				}),
			],
			content: '<p>Click [[New Topic]] to start.</p>',
		})

		// 1. Initially workspace is not yet loaded
		const mockEl = document.createElement('span')
		mockEl.setAttribute('data-wikilink-target', 'New Topic')
		mockEl.setAttribute('data-wikilink-resolved', 'false')

		const mockEvent = {
			target: mockEl,
			preventDefault: () => {},
		} as unknown as MouseEvent

		const plugins = editor.view.state.plugins
		const wikilinkPlugin = plugins.find((p: any) => p.key === (wikilinkPluginKey as any).key)
		expect(wikilinkPlugin).toBeDefined()

		// Click before workspace loaded
		const handledBefore = (wikilinkPlugin as any)?.props.handleClick?.(editor.view, 1, mockEvent)
		expect(handledBefore).toBe(true)
		expect(createdTitle).toBeNull()

		// 2. Workspace loads asynchronously
		currentWorkspaceId = 'ws-456'
		editor.commands.setWorkspacePages([{ id: 'other-page', title: 'Other Page' }])

		// Click after workspace loaded
		const handledAfter = (wikilinkPlugin as any)?.props.handleClick?.(editor.view, 1, mockEvent)
		expect(handledAfter).toBe(true)
		expect(createdTitle).toBe('ws-456:New Topic')

		editor.destroy()
	})
})

describe('buildWikilinkSuggestions ([[ popup items, SIL-159 #142])', () => {
	const pages = [
		{ id: 'p1', title: 'Meeting Notes' },
		{ id: 'p2', title: 'meeting follow-ups' },
		{ id: 'p3', title: 'Research: Obsidian' },
		{ id: 'p4', title: 'Daily Note' },
		{ id: 'p5', title: 'Daily Note 2' },
		{ id: 'p6', title: 'Daily Note 3' },
		{ id: 'p7', title: 'Daily Note 4' },
		{ id: 'p8', title: 'Daily Note 5' },
		{ id: 'p9', title: 'Daily Note 6' },
	]

	it('lists case-insensitive matches for a query', () => {
		const items = buildWikilinkSuggestions(pages, 'MEET')
		const titles = items.filter(i => i.kind === 'page').map(i => i.title)
		expect(titles).toContain('Meeting Notes')
		expect(titles).toContain('meeting follow-ups')
	})

	it('is whitespace-insensitive via the same normalize used to resolve links', () => {
		const items = buildWikilinkSuggestions(pages, 'research:  obsidian')
		expect(items.some(i => i.kind === 'page' && i.title === 'Research: Obsidian')).toBe(true)
	})

	it('caps page results at 8 and still appends the create affordance', () => {
		const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ id: `d${n}`, title: `Daily Note ${n}` }))
		const items = buildWikilinkSuggestions(nine, 'daily note')
		expect(items.filter(i => i.kind === 'page')).toHaveLength(8)
		const createItem = items.find(i => i.kind === 'create')
		expect(createItem).toBeDefined()
		expect(createItem?.title).toBe('daily note')
	})

	it('offers create when no page matches, keeping the typed name', () => {
		const items = buildWikilinkSuggestions(pages, 'Project F')
		expect(items).toHaveLength(1)
		expect(items[0].kind).toBe('create')
		expect(items[0].title).toBe('Project F')
	})

	it('does not offer create when an exact (normalized) page match exists', () => {
		const items = buildWikilinkSuggestions(pages, 'meeting notes')
		expect(items.some(i => i.kind === 'create')).toBe(false)
		expect(items.some(i => i.kind === 'page' && i.title === 'Meeting Notes')).toBe(true)
	})

	it('shows pages for an empty query in a populated workspace (no create, no hint)', () => {
		const items = buildWikilinkSuggestions(pages, '')
		expect(items.some(i => i.kind === 'create')).toBe(false)
		expect(items.some(i => i.kind === 'hint')).toBe(false)
		expect(items.filter(i => i.kind === 'page')).toHaveLength(8)
	})

	it('shows a hint instead of a create affordance for an empty query in an empty workspace', () => {
		const items = buildWikilinkSuggestions([], '')
		expect(items).toHaveLength(1)
		expect(items[0].kind).toBe('hint')
	})

	it('excludes pages whose titles cannot round-trip through the wikilink grammar', () => {
		const weird = [
			{ id: 'w1', title: 'Team Notes | Weekly' },
			{ id: 'w2', title: 'my [page' },
			{ id: 'w3', title: 'Plain Page' },
		]
		// Affected by the exclusion even on a broad match: only w3
		// ("Plain Page") survives, w1/w2 are grammar-unlinkable.
		const broad = buildWikilinkSuggestions(weird, 'e')
		expect(broad.filter(i => i.kind === 'page').map(i => i.id)).toEqual(['w3'])
		// …and grammar-only titles are never offered as the exact "existing" match.
		expect(buildWikilinkSuggestions(weird, 'team notes | weekly')).toEqual([
			{ id: '__wikilink_create__', title: 'team notes  weekly', kind: 'create' },
		])
	})

	it('sanitizes grammar characters out of the create affordance target', () => {
		const items = buildWikilinkSuggestions(pages, 'my [page | drafts]]')
		expect(items.filter(i => i.kind === 'page')).toHaveLength(0)
		const createItem = items.find(i => i.kind === 'create')
		expect(createItem?.title).toBe('my page  drafts')
	})
})

describe('`[[` suggestion popup lifecycle (SIL-159 #142)', () => {
	// The suggestion plugin registers its state under `<name>$` (first
	// PluginKey instance for that name); resolving via the raw key lets the
	// tests assert popup state headlessly without importing internals.
	const suggestionState = (state: EditorState) =>
		(state as unknown as Record<string, any>)['wikilinkSuggestion$']

	const PAGES = [{ id: 'p1', title: 'Meeting Notes' }]

	const makeEditor = () => {
		let committed: { title: string; kind: string; query?: string } | null = null
		const editor = new Editor({
			extensions: [
				StarterKit,
				Wikilink.configure({
					workspacePages: PAGES,
					suggestion: {
						char: '[[',
						allowedPrefixes: null,
						items: ({ query }: { query: string }) => buildWikilinkSuggestions(PAGES, query),
						command: (args: any) => { committed = args.props },
					},
				}),
			],
			content: '<p>Hello quick</p>',
		})
		return { editor, getCommitted: () => committed }
	}

	it('activates mid-sentence while typing `[[` + query (criterion 1)', () => {
		const { editor } = makeEditor()
		editor.commands.insertContentAt(6, ' [[New')
		// insertContentAt leaves the cursor right after the inserted text.

		// Mid-sentence activation (criterion 1): space prefix satisfied even
		// before any allowPrefixes config, and allowedPrefixes null also
		// permits after-any-character.
		expect(suggestionState(editor.state).active).toBe(true)
		expect(suggestionState(editor.state).query).toBe('New')
		// Range must cover the open `[[` through the cursor so commit replaces it
		expect(suggestionState(editor.state).range).toEqual({ from: 7, to: 12 })

		editor.destroy()
	})

	it('stays down after committing a single-word link closed with ]] (criterion 4)', () => {
		const { editor } = makeEditor()
		editor.commands.insertContentAt(6, ' [[Mtg')
		const state = suggestionState(editor.state)
		expect(state.active).toBe(true)

		// Reproduce the live popup commit: replace the suggestion range with
		// the complete link text. With a one-word title there is no space to
		// break the matcher, so a naive matcher re-fires on "[[Mtg]]".
		editor.chain()
			.focus()
			.insertContentAt(state.range, { type: 'text', text: '[[Mtg]]' })
			.run()

		const after = suggestionState(editor.state)
		expect(after.active).toBe(false)
		expect(editor.getText()).toContain('Hello [[Mtg]] quick')

		editor.destroy()
	})

	it('stays down while typing after a committed link (criterion 4)', () => {
		const { editor } = makeEditor()
		editor.commands.insertContentAt(6, ' [[Mtg')
		const state = suggestionState(editor.state)
		editor.chain().focus().insertContentAt(state.range, { type: 'text', text: '[[Mtg]]' }).run()

		editor.commands.insertContent(' again')

		const after = suggestionState(editor.state)
		expect(after.active).toBe(false)

		editor.destroy()
	})

	it('dismisses via the Suggestion exit meta (Esc, criterion 2) and stays down while typing', () => {
		const { editor } = makeEditor()
		editor.commands.insertContentAt(6, ' [[New')

		expect(suggestionState(editor.state).active).toBe(true)

		// The Escape branch of Suggestion's props.handleKeyDown dispatches this.
		editor.view.dispatch(editor.state.tr.setMeta('wikilinkSuggestion$' as any, { exit: true }))
		expect(suggestionState(editor.state).active).toBe(false)

		// Typing more characters at the same range stays dismissed.
		editor.commands.insertContent('x')
		expect(suggestionState(editor.state).active).toBe(false)

		editor.destroy()
	})
})
describe('`[[` popup — clean-room review round 2 (SIL-159)', () => {
	const suggestionState2 = (state: EditorState) =>
		(state as unknown as Record<string, any>)['wikilinkSuggestion$']

	const PAGES2 = [{ id: 'p1', title: 'Meeting Notes' }]

	const makeEditor2 = () => {
		const editor = new Editor({
			extensions: [
				StarterKit,
				Wikilink.configure({
					workspacePages: PAGES2,
					suggestion: {
						char: '[[',
						allowedPrefixes: null,
						items: ({ query }: { query: string }) => buildWikilinkSuggestions(PAGES2, query),
						command: () => {},
					},
				}),
			],
			content: '<p>Hello quick</p>',
		})
		return editor
	}

	it('BLOCKER regression: caret inside a closed [[Link]] never activates the popup', () => {
		const editor = makeEditor2()
		editor.commands.setContent('<p>[[Meeting Notes]] done</p>')
		// Caret one character into the closed link body ("[[M|eeting Notes]]").
		editor.commands.setTextSelection(4)

		expect(suggestionState2(editor.state).active).toBe(false)
		editor.destroy()
	})

	it('BLOCKER regression: typing inside a closed link then committing cannot orphan the ]] tail', () => {
		const editor = makeEditor2()
		editor.commands.setContent('<p>[[Meeting Notes]] done</p>')
		// A user replaces one character inside the link body ("[[M|xting…") —
		// matcher input ends at the caret, but the trailing `]]` must keep
		// the popup down so a stray commit can never orphan the tail.
		editor.commands.insertContentAt({ from: 4, to: 5 }, '')
		editor.commands.setTextSelection(4)
		editor.commands.insertContent('x')

		// Popup never fires inside the closed link…
		expect(suggestionState2(editor.state).active).toBe(false)
		// …and the document survives the edit untouched by popup logic.
		expect(editor.getText()).toBe('[[Mxeting Notes]] done')

		editor.destroy()
	})

	it('closes when the whole `[[` gesture range is deleted (criterion 2)', () => {
		const editor = makeEditor2()
		editor.commands.insertContentAt(6, ' [[New')
		expect(suggestionState2(editor.state).active).toBe(true)

		const range = suggestionState2(editor.state).range as { from: number; to: number }
		editor.commands.deleteRange(range)
		expect(suggestionState2(editor.state).active).toBe(false)

		// And it comes back when the gesture is typed again at the same spot.
		editor.commands.insertContentAt(range.from, ' [[Az')
		expect(suggestionState2(editor.state).active).toBe(true)

		editor.destroy()
	})
})

describe('buildWikilinkSuggestions — grammar-only query falls back to hint (clean-room NIT)', () => {
	it('shows the hint instead of an empty list when the sanitized create target is empty', () => {
		const items = buildWikilinkSuggestions([], '[[')
		expect(items).toHaveLength(1)
		expect(items[0].kind).toBe('hint')
	})
})

describe('`[[` popup — round 3: closed link with alias (clean-room residual blocker)', () => {
	it('caret inside "[[spaced target|alias]]" does not activate (corruption guard)', () => {
		let editor: Editor | null = null
		try {
			editor = new Editor({
				extensions: [
					StarterKit,
					Wikilink.configure({
						workspacePages: [{ id: 'p1', title: 'Something' }],
						suggestion: {
							char: '[[',
							allowedPrefixes: null,
							items: () => [],
							command: () => {},
						},
					}),
				],
				content: '<p>[[te st|al]] done</p>',
			})
			// Caret two characters into the target body ("[[te|st|al]]"), where
			// the stock matcher's space-stopped match leaves the closed "]]" on
			// the tail — committing there would orphan " st|al]]".
			editor.commands.setTextSelection(7)
			expect(
				((editor.state as any) as Record<string, any>)['wikilinkSuggestion$'].active
			).toBe(false)
		} finally {
			editor?.destroy()
		}
	})

	it('a genuinely open link with a typed alias still opens ("[[te|al", nothing ahead)', () => {
		let editor: Editor | null = null
		try {
			editor = new Editor({
				extensions: [
					StarterKit,
					Wikilink.configure({
						workspacePages: [{ id: 'p1', title: 'Something' }],
						suggestion: {
							char: '[[',
							allowedPrefixes: null,
							items: () => [],
							command: () => {},
						},
					}),
				],
				// No space in the body, so the stock matcher's match reaches the
				// caret and activation is possible; nothing ahead but paragraph end.
				content: '<p>[[te|al</p>',
			})
			// Caret inside the paragraph, right at the end of the alias — not
			// past the paragraph boundary, where nodeBefore is not text.
			editor.commands.setTextSelection(editor.state.doc.content.size - 1)
			expect(
				((editor.state as any) as Record<string, any>)['wikilinkSuggestion$'].active
			).toBe(true)
		} finally {
			editor?.destroy()
		}
	})
})
