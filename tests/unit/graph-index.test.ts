import { describe, it, expect, vi } from 'vitest'
import { extractLinks, extractTags, normalizeTitle, getWorkspaceForPage, indexPage } from '../../server/graph-index'

describe('extractLinks', () => {
	it('extracts plain wikilinks', () => {
		expect(extractLinks('See [[Project Alpha]] for details')).toEqual([
			{ title: 'Project Alpha', alias: null },
		])
	})

	it('extracts aliased wikilinks', () => {
		expect(extractLinks('Read [[long note|the note]] now')).toEqual([
			{ title: 'long note', alias: 'the note' },
		])
	})

	it('extracts multiple links and dedupes by title', () => {
		expect(extractLinks('[[A]] and [[A]] and [[B]]')).toEqual([
			{ title: 'A', alias: null },
			{ title: 'B', alias: null },
		])
	})

	it('ignores malformed or empty links', () => {
		expect(extractLinks('no links here')).toEqual([])
		expect(extractLinks('[[  ]]')).toEqual([])
	})

	it('returns empty array for non-string input', () => {
		expect(extractLinks(null as unknown as string)).toEqual([])
	})
})

describe('extractTags', () => {
	it('extracts hashtags at word boundaries', () => {
		expect(extractTags('meeting #work and #work again #ideas')).toEqual(['work', 'ideas'])
	})

	it('supports hierarchical tags', () => {
		expect(extractTags('tag #project/alpha here')).toEqual(['project/alpha'])
	})

	it('does not match mid-word hashes', () => {
		expect(extractTags('email me at a#b')).toEqual([])
	})

	it('returns empty array for non-string input', () => {
		expect(extractTags(null as unknown as string)).toEqual([])
	})
})

describe('normalizeTitle', () => {
	it('lowercases, trims and collapses whitespace', () => {
		expect(normalizeTitle('  Project   ALPHA ')).toBe('project alpha')
	})

	it('handles empty input', () => {
		expect(normalizeTitle('')).toBe('')
	})
})

describe('getWorkspaceForPage', () => {
	it('returns workspace_id for an existing page', async () => {
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({ data: { workspace_id: 'ws-1' }, error: null })),
					})),
				})),
			})),
		}
		expect(await getWorkspaceForPage(admin, 'page-1')).toBe('ws-1')
	})

	it('returns null when the page does not exist', async () => {
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({ data: null, error: null })),
					})),
				})),
			})),
		}
		expect(await getWorkspaceForPage(admin, 'missing')).toBeNull()
	})
})
describe('indexPage', () => {
	const pageText = '# Notes\nMeeting with [[Priya]] about #work\nAlso see [[Priya]] again'

	it('replaces links, tags and searchable_text via a single transactional rpc call', async () => {
		let pageSelectCalls = 0
		const workspacePagesData = [{ id: 'priya-page', title: 'Priya' }]

		// A builder node that is BOTH directly awaitable (indexPage's workspace-pages
		// fetch awaits .eq() itself) AND chainable (.maybeSingle() for getWorkspaceForPage).
		const makePageEq = () => {
			const node = {
				maybeSingle: vi.fn(async () => {
					pageSelectCalls += 1
					if (pageSelectCalls === 1) return { data: { workspace_id: 'ws-1' }, error: null }
					return { data: workspacePagesData, error: null }
				}),
				then: (onfulfilled: any) =>
					Promise.resolve({ data: workspacePagesData, error: null }).then(onfulfilled),
			}
			return node
		}

		const admin: any = {
			from: vi.fn((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn(() => ({ eq: makePageEq })),
						update: vi.fn(),
					}
				}
				return {}
			}),
			rpc: vi.fn(async () => ({ data: { links: 1, tags: 1 }, error: null })),
		}

		const result = await indexPage(admin, 'page-1', pageText)

		expect(result).toEqual({ links: 1, tags: 1 })
		expect(admin.rpc).toHaveBeenCalledTimes(1)
		expect(admin.rpc).toHaveBeenCalledWith('sync_page_graph', {
			p_page_id: 'page-1',
			p_workspace_id: 'ws-1',
			p_searchable_text: pageText,
			p_links: [
				{ workspace_id: 'ws-1', from_page_id: 'page-1', to_page_id: 'priya-page', to_title: 'Priya' },
			],
			p_tags: [{ page_id: 'page-1', tag: 'work' }],
		})
		// Concurrency guard (finding #8): all mutation goes through the single
		// transactional rpc — no interleavable table-level delete/insert calls.
		expect(admin.from).not.toHaveBeenCalledWith('page_links')
		expect(admin.from).not.toHaveBeenCalledWith('page_tags')
		expect(admin.from('pages').update).not.toHaveBeenCalled()
	})

	it('passes empty rows and persists text when the page has no workspace', async () => {
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({ data: null, error: null })),
					})),
				})),
			})),
			rpc: vi.fn(async () => ({ data: { links: 0, tags: 0 }, error: null })),
		}
		const result = await indexPage(admin, 'page-1', '[[Any]]')

		expect(result).toEqual({ links: 0, tags: 0 })
		expect(admin.rpc).toHaveBeenCalledWith('sync_page_graph', {
			p_page_id: 'page-1',
			p_workspace_id: null,
			p_searchable_text: '[[Any]]',
			p_links: [],
			p_tags: [],
		})
	})

	it('throws when the workspace lookup carries an error', async () => {
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({ data: null, error: { message: 'workspace lookup failed' } })),
					})),
				})),
			})),
		}
		await expect(indexPage(admin, 'page-1', 'text')).rejects.toMatchObject({ message: 'workspace lookup failed' })
	})

	it('throws when the transactional rpc call carries an error', async () => {
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({ data: { workspace_id: 'ws-1' }, error: null })),
					})),
				})),
			})),
			rpc: vi.fn(async () => ({ data: null, error: { message: 'sync failed' } })),
		}
		await expect(indexPage(admin, 'page-1', 'text')).rejects.toMatchObject({ message: 'sync failed' })
	})
})