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

	it('upserts links, tags and searchable_text for a known page', async () => {
		const insertedLinks: any[] = []
		const insertedTags: any[] = []
		const pagesUpdates: Array<{ fields: Record<string, unknown>; id: string }> = []
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
						update: vi.fn((fields: Record<string, unknown>) => ({
							eq: vi.fn(async (column: string, id: string) => {
								pagesUpdates.push({ fields, id })
								return { data: null, error: null }
							}),
						})),
					}
				}
				if (table === 'page_links') {
					return {
						delete: vi.fn(() => ({
							eq: vi.fn(async () => ({ data: null, error: null })),
						})),
						insert: vi.fn(async (rows: any[]) => {
							insertedLinks.push(...rows)
							return { data: null, error: null }
						}),
					}
				}
				if (table === 'page_tags') {
					return {
						delete: vi.fn(() => ({
							eq: vi.fn(async () => ({ data: null, error: null })),
						})),
						insert: vi.fn(async (rows: any[]) => {
							insertedTags.push(...rows)
							return { data: null, error: null }
						}),
					}
				}
				return {}
			}),
		}

		const result = await indexPage(admin, 'page-1', pageText)

		expect(result).toEqual({ links: 1, tags: 1 })
		expect(insertedLinks).toEqual([
			{ workspace_id: 'ws-1', from_page_id: 'page-1', to_page_id: 'priya-page', to_title: 'Priya' },
		])
		expect(insertedTags).toEqual([{ page_id: 'page-1', tag: 'work' }])
		expect(admin.from).toHaveBeenCalledWith('pages')
		expect(admin.from).toHaveBeenCalledWith('page_links')
		expect(admin.from).toHaveBeenCalledWith('page_tags')

		// Findings #4/#5a: exactly one pages.update per save, carrying both
		// searchable_text (the passed text) and updated_at.
		expect(pagesUpdates).toHaveLength(1)
		expect(pagesUpdates[0]).toEqual({
			fields: { searchable_text: pageText, updated_at: expect.any(String) },
			id: 'page-1',
		})
	})

	it('resolves nothing and stores no links when the page has no workspace', async () => {
		const pagesUpdateCalls: Array<Record<string, unknown>> = []
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({ data: null, error: null })),
					})),
				})),
				update: vi.fn((fields: Record<string, unknown>) => {
					pagesUpdateCalls.push(fields)
					return { eq: vi.fn(async () => ({ data: null, error: null })) }
				}),
			})),
		}
		const result = await indexPage(admin, 'page-1', '[[Any]]')
		expect(result).toEqual({ links: 0, tags: 0 })
		expect(admin.from).not.toHaveBeenCalledWith('page_links')
		// searchable_text is still persisted even without a workspace
		expect(pagesUpdateCalls).toHaveLength(1)
		expect(pagesUpdateCalls[0]).toEqual({
			searchable_text: '[[Any]]',
			updated_at: expect.any(String),
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

	it('throws when the final pages update carries an error', async () => {
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({ data: null, error: null })),
					})),
				})),
				update: vi.fn(() => ({
					eq: vi.fn(async () => ({ data: null, error: { message: 'update failed' } })),
				})),
			})),
		}
		await expect(indexPage(admin, 'page-1', 'text')).rejects.toMatchObject({ message: 'update failed' })
	})
})