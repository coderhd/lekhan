import { describe, it, expect } from 'vitest'
import { serializeWorkspaceGraph } from '@/lib/graph-view/serialize'
import type { Page, PageLink } from '@/types'

const page = (id: string, title: string, overrides: Partial<Page> = {}): Page => ({
	id,
	workspace_id: 'ws-1',
	parent_id: null,
	title,
	owner_id: 'user-1',
	icon: null,
	cover: null,
	properties: {},
	is_public: false,
	searchable_text: null,
	created_at: '2026-11-01T00:00:00.000Z',
	updated_at: '2026-11-02T00:00:00.000Z',
	...overrides,
})

const link = (overrides: Partial<PageLink> & Pick<PageLink, 'id' | 'from_page_id'>): PageLink => ({
	workspace_id: 'ws-1',
	to_page_id: null,
	to_title: 'Target',
	block_id: null,
	created_at: '2026-11-02T00:00:00.000Z',
	...overrides,
})

describe('serializeWorkspaceGraph', () => {
	it('maps pages to nodes and resolved links to edges', () => {
		const data = serializeWorkspaceGraph({
			pages: [page('p-1', 'Alpha', { is_public: true }), page('p-2', 'Beta')],
			links: [link({ id: 'l-1', from_page_id: 'p-1', to_page_id: 'p-2', to_title: 'Beta' })],
			tagsByPage: new Map([['p-1', ['research', 'pkm']]]),
		})

		expect(data.nodes).toEqual([
			expect.objectContaining({ id: 'p-1', kind: 'page', title: 'Alpha', isPublic: true, tags: ['research', 'pkm'] }),
			expect.objectContaining({ id: 'p-2', kind: 'page', title: 'Beta', isPublic: false, tags: [] }),
		])
		expect(data.edges).toEqual([
			{ id: 'l-1', source: 'p-1', target: 'p-2', unresolved: false },
		])
		expect(data.totalPages).toBe(2)
		expect(data.totalLinks).toBe(1)
		expect(data.unresolvedLinks).toBe(0)
	})

	it('renders unresolved links as deduped ghost nodes labelled with to_title', () => {
		const data = serializeWorkspaceGraph({
			pages: [page('p-1', 'Alpha'), page('p-2', 'Beta')],
			links: [
				link({ id: 'l-1', from_page_id: 'p-1', to_page_id: null, to_title: '  Missing Note  ' }),
				link({ id: 'l-2', from_page_id: 'p-2', to_page_id: null, to_title: 'missing note' }),
				link({ id: 'l-3', from_page_id: 'p-1', to_page_id: 'p-2', to_title: 'Beta' }),
			],
		})

		const ghosts = data.nodes.filter(node => node.kind === 'unresolved')
		expect(ghosts).toHaveLength(1)
		expect(ghosts[0]).toMatchObject({
			id: 'ghost:missing note',
			kind: 'unresolved',
			title: 'Missing Note',
			tags: [],
			isPublic: false,
		})

		expect(data.edges).toEqual([
			{ id: 'l-1', source: 'p-1', target: 'ghost:missing note', unresolved: true },
			{ id: 'l-2', source: 'p-2', target: 'ghost:missing note', unresolved: true },
			{ id: 'l-3', source: 'p-1', target: 'p-2', unresolved: false },
		])
		expect(data.unresolvedLinks).toBe(2)
		expect(data.totalLinks).toBe(3)
	})

	it('builds tag facets from page tags, most-used first', () => {
		const data = serializeWorkspaceGraph({
			pages: [page('p-1', 'Alpha'), page('p-2', 'Beta'), page('p-3', 'Gamma')],
			links: [],
			tagsByPage: new Map([
				['p-1', ['research', 'pkm']],
				['p-2', ['research']],
				['p-3', ['research', 'journal']],
			]),
		})

		expect(data.tags).toEqual([
			{ tag: 'research', count: 3 },
			{ tag: 'journal', count: 1 },
			{ tag: 'pkm', count: 1 },
		])
	})

	it('drops self-links, links from unknown pages, and unlabelled unresolved links', () => {
		const data = serializeWorkspaceGraph({
			pages: [page('p-1', 'Alpha')],
			links: [
				link({ id: 'self', from_page_id: 'p-1', to_page_id: 'p-1', to_title: 'Alpha' }),
				link({ id: 'orphan', from_page_id: 'gone', to_page_id: 'p-1', to_title: 'Alpha' }),
				link({ id: 'blank', from_page_id: 'p-1', to_page_id: null, to_title: '   ' }),
				link({ id: 'ok', from_page_id: 'p-1', to_page_id: null, to_title: 'Later' }),
			],
			tagsByPage: new Map(),
		})

		expect(data.edges).toEqual([
			{ id: 'ok', source: 'p-1', target: 'ghost:later', unresolved: true },
		])
		expect(data.totalLinks).toBe(4)
		expect(data.unresolvedLinks).toBe(1)
	})

	it('handles an empty workspace without inventing nodes', () => {
		const data = serializeWorkspaceGraph({ pages: [], links: [], tagsByPage: new Map() })

		expect(data.nodes).toEqual([])
		expect(data.edges).toEqual([])
		expect(data.tags).toEqual([])
		expect(data.totalPages).toBe(0)
		expect(data.totalLinks).toBe(0)
		expect(data.unresolvedLinks).toBe(0)
	})

	it('keeps page order stable and appends ghosts in first-seen order', () => {
		const data = serializeWorkspaceGraph({
			pages: [page('p-2', 'Beta'), page('p-1', 'Alpha')],
			links: [
				link({ id: 'l-2', from_page_id: 'p-2', to_page_id: null, to_title: 'Zeta' }),
				link({ id: 'l-1', from_page_id: 'p-1', to_page_id: null, to_title: 'Eta' }),
			],
			tagsByPage: new Map(),
		})

		expect(data.nodes.map(node => node.id)).toEqual(['p-2', 'p-1', 'ghost:zeta', 'ghost:eta'])
	})
})
