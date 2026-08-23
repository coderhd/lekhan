import { describe, it, expect, vi } from 'vitest'
import { extractLinks, extractTags, normalizeTitle, getWorkspaceForPage, indexPage, indexPages } from '../../server/graph-index'

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
	it('returns workspace_id and properties for an existing page', async () => {
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({
							data: { workspace_id: 'ws-1', properties: { tags: ['work'] } },
							error: null,
						})),
					})),
				})),
			})),
		}
		expect(await getWorkspaceForPage(admin, 'page-1')).toEqual({ workspaceId: 'ws-1', properties: { tags: ['work'] } })
		expect(admin.from).toHaveBeenCalledWith('pages')
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

	// A builder node that is BOTH directly awaitable (indexPage's workspace-pages
	// fetch awaits .eq() itself) AND chainable (.maybeSingle() for getWorkspaceForPage).
	// `maybeSingle` returns the page row (workspace_id + properties); the `then`
	// path returns the workspace pages used for link resolution.
	const makePageEq = (pageRow: { workspace_id: string; properties: Record<string, unknown> }) => {
		const node = {
			maybeSingle: vi.fn(async () => ({ data: pageRow, error: null })),
			then: (onfulfilled: any) =>
				Promise.resolve({ data: workspacePagesData, error: null }).then(onfulfilled),
		}
		return node
	}

	const workspacePagesData = [{ id: 'priya-page', title: 'Priya' }]

	const makeAdmin = (rpcResult: any = { data: { links: 1, tags: 1 }, error: null }, pageRow: { workspace_id: string; properties: Record<string, unknown> } = { workspace_id: 'ws-1', properties: {} }) => {
		const admin: any = {
			from: vi.fn((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn(() => ({ eq: vi.fn(() => makePageEq(pageRow)) })),
						update: vi.fn(),
					}
				}
				return {}
			}),
			rpc: vi.fn(async () => rpcResult),
		}
		return admin
	}

	it('replaces links, tags and searchable_text via a single transactional rpc call', async () => {
		const admin = makeAdmin()
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

	it('folds properties.tags (array form) into the tag rows alongside body tags', async () => {
		const admin = makeAdmin({ data: { links: 1, tags: 2 }, error: null }, { workspace_id: 'ws-1', properties: { tags: ['frontmatter', 'work'] } })

		const result = await indexPage(admin, 'page-1', pageText)
		expect(result).toEqual({ links: 1, tags: 2 })
		expect(admin.rpc).toHaveBeenCalledWith('sync_page_graph', {
			p_page_id: 'page-1',
			p_workspace_id: 'ws-1',
			p_searchable_text: pageText,
			p_links: [
				{ workspace_id: 'ws-1', from_page_id: 'page-1', to_page_id: 'priya-page', to_title: 'Priya' },
			],
			// body #work first, then properties.tags with `work` deduped against the body tag
			p_tags: [
				{ page_id: 'page-1', tag: 'work' },
				{ page_id: 'page-1', tag: 'frontmatter' },
			],
		})
	})

	it('folds properties.tags string form (comma/space separated) into tag rows', async () => {
		const admin = makeAdmin({ data: { links: 0, tags: 3 }, error: null }, { workspace_id: 'ws-1', properties: { tags: 'meeting, project/alpha  urgent' } })

		const result = await indexPage(admin, 'page-1', 'plain text')
		expect(result).toEqual({ links: 0, tags: 3 })
		expect(admin.rpc).toHaveBeenCalledWith('sync_page_graph', {
			p_page_id: 'page-1',
			p_workspace_id: 'ws-1',
			p_searchable_text: 'plain text',
			p_links: [],
			p_tags: [
				{ page_id: 'page-1', tag: 'meeting' },
				{ page_id: 'page-1', tag: 'project/alpha' },
				{ page_id: 'page-1', tag: 'urgent' },
			],
		})
	})

	it('keeps body tags and links unchanged when properties.tags is absent', async () => {
		const admin = makeAdmin()
		const result = await indexPage(admin, 'page-1', pageText)
		expect(admin.rpc).toHaveBeenCalledWith('sync_page_graph', {
			p_page_id: 'page-1',
			p_workspace_id: 'ws-1',
			p_searchable_text: pageText,
			p_links: [
				{ workspace_id: 'ws-1', from_page_id: 'page-1', to_page_id: 'priya-page', to_title: 'Priya' },
			],
			p_tags: [{ page_id: 'page-1', tag: 'work' }],
		})
		expect(result).toEqual({ links: 1, tags: 1 })
	})

	it('normalizes and dedupes property tags (case, whitespace, duplicates) against body tags', async () => {
		const admin = makeAdmin({ data: { links: 1, tags: 2 }, error: null }, { workspace_id: 'ws-1', properties: { tags: ['Work', 'work', '  spaced  ', ''] } })

		const result = await indexPage(admin, 'page-1', pageText)
		expect(result).toEqual({ links: 1, tags: 2 })
		expect(admin.rpc).toHaveBeenCalledWith('sync_page_graph', {
			p_page_id: 'page-1',
			p_workspace_id: 'ws-1',
			p_searchable_text: pageText,
			p_links: [
				{ workspace_id: 'ws-1', from_page_id: 'page-1', to_page_id: 'priya-page', to_title: 'Priya' },
			],
			p_tags: [
				{ page_id: 'page-1', tag: 'work' },
				{ page_id: 'page-1', tag: 'spaced' },
			],
		})
	})

	it('drops property tags outside the body-tag character set', async () => {
		const admin = makeAdmin({ data: { links: 1, tags: 2 }, error: null }, { workspace_id: 'ws-1', properties: { tags: ['a b', '##', '@#', 'ok/tag'] } })

		const result = await indexPage(admin, 'page-1', pageText)
		expect(result).toEqual({ links: 1, tags: 2 })
		expect(admin.rpc).toHaveBeenCalledWith('sync_page_graph', {
			p_page_id: 'page-1',
			p_workspace_id: 'ws-1',
			p_searchable_text: pageText,
			p_links: [
				{ workspace_id: 'ws-1', from_page_id: 'page-1', to_page_id: 'priya-page', to_title: 'Priya' },
			],
			// invalid `a b`, `##`, `@#` are dropped; only the body #work and ok/tag survive
			p_tags: [
				{ page_id: 'page-1', tag: 'work' },
				{ page_id: 'page-1', tag: 'ok/tag' },
			],
		})
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
						maybeSingle: vi.fn(async () => ({ data: { workspace_id: 'ws-1', properties: {} }, error: null })),
					})),
				})),
			})),
			rpc: vi.fn(async () => ({ data: null, error: { message: 'sync failed' } })),
		}
		await expect(indexPage(admin, 'page-1', 'text')).rejects.toMatchObject({ message: 'sync failed' })
	})
})

describe('indexPages', () => {
	function makeAdmin(opts: { pagesRows?: unknown[]; workspacePages?: unknown[]; rpcError?: unknown }) {
		const fromCalls: string[] = []
		const admin: any = {
			from: vi.fn((table: string) => {
				fromCalls.push(table)
				return {
					select: vi.fn(() => ({
						in: vi.fn(async () => ({ data: opts.pagesRows ?? [], error: null })),
						eq: vi.fn(async () => ({ data: opts.workspacePages ?? [], error: null })),
					})),
				}
			}),
			rpc: vi.fn(async () => (opts.rpcError ? { data: null, error: opts.rpcError } : { data: { links: 1, tags: 1 }, error: null })),
		}
		return { admin, fromCalls }
	}

	it('resolves links against one title index for the whole batch', async () => {
		const { admin, fromCalls } = makeAdmin({
			pagesRows: [
				{ id: 'p1', workspace_id: 'ws-1', properties: {} },
				{ id: 'p2', workspace_id: 'ws-1', properties: {} },
			],
			workspacePages: [{ id: 'p2', title: 'Target' }],
		})

		const result = await indexPages(admin, [
			{ pageId: 'p1', plainText: 'see [[Target]]' },
			{ pageId: 'p2', plainText: 'no links' },
		])

		expect(result.indexed).toEqual(['p1', 'p2'])
		expect(result.errors).toEqual([])
		// One page-rows fetch + ONE workspace fetch for both pages.
		expect(fromCalls.filter((_, i) => i > 0)).toHaveLength(1)
	})

	it('isolates per-page failures without failing the batch', async () => {
		let rpcCalls = 0
		const { admin } = makeAdmin({
			pagesRows: [
				{ id: 'p1', workspace_id: 'ws-1', properties: {} },
				{ id: 'bad', workspace_id: 'ws-1', properties: {} },
			],
			workspacePages: [],
		})
		admin.rpc = vi.fn(async () => {
			rpcCalls++
			if (rpcCalls === 2) return { data: null, error: { message: 'sync exploded' } }
			return { data: { links: 0, tags: 0 }, error: null }
		})

		const result = await indexPages(admin, [
			{ pageId: 'p1', plainText: 'a [[B]]' },
			{ pageId: 'bad', plainText: 'c' },
		])

		expect(result.indexed).toEqual(['p1'])
		expect(result.errors).toEqual([{ pageId: 'bad', error: 'sync exploded' }])
	})
})
