import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
	supabase: { rpc: rpcMock },
}))

const ensureWorkspace = vi.fn()
const fetchWorkspacePages = vi.fn()
const fetchSharedPages = vi.fn()
vi.mock('@/services/graph', () => ({
	ensureWorkspace: (...args: any[]) => ensureWorkspace(...args),
	fetchWorkspacePages: (...args: any[]) => fetchWorkspacePages(...args),
	fetchSharedPages: (...args: any[]) => fetchSharedPages(...args),
}))

import { supabase } from '@/lib/supabase'
import { fetchRecentPages, searchPages } from '@/services/search'
import type { SearchResult } from '@/types'

describe('searchPages', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('calls the search_pages RPC with the query and limit', async () => {
		const rows = [
			{ id: 'p-1', title: 'Obsidian Workflow', icon: null, workspace_id: 'ws-1', updated_at: '2026-08-14T00:00:00Z', surface: 'title', context: null },
		] as SearchResult[]
		rpcMock.mockResolvedValue({ data: rows, error: null })
		const result = await searchPages('obsidian', 15)
		expect(supabase.rpc).toHaveBeenCalledWith('search_pages', { p_query: 'obsidian', p_limit: 15 })
		expect(result).toEqual(rows)
	})

	it('throws on RPC error', async () => {
		rpcMock.mockResolvedValue({ data: null, error: new Error('boom') })
		await expect(searchPages('obsidian')).rejects.toThrow('boom')
	})

	it('returns an empty list when data is null', async () => {
		rpcMock.mockResolvedValue({ data: null, error: null })
		expect(await searchPages('nothing')).toEqual([])
	})
})

describe('fetchRecentPages', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		ensureWorkspace.mockResolvedValue({ id: 'ws-1', owner_id: 'user-1', name: 'My Workspace', is_team: false, created_at: '', updated_at: '' })
	})

	it('returns owned + shared pages sorted by recency and sliced to the limit', async () => {
		const owned = [
			{ id: 'p-1', title: 'Old', owner_id: 'user-1', workspace_id: 'ws-1', updated_at: '2026-08-01T00:00:00Z' },
			{ id: 'p-2', title: 'Shared Also Owned', owner_id: 'user-1', workspace_id: 'ws-1', updated_at: '2026-08-02T00:00:00Z' },
		]
		const shared = [
			{ role: 'editor', pages: { id: 'p-2', title: 'Shared Also Owned', owner_id: 'other', workspace_id: 'ws-9', updated_at: '2026-08-02T00:00:00Z' } },
			{ role: 'editor', pages: { id: 'p-3', title: 'Newest Shared', owner_id: 'other', workspace_id: 'ws-9', updated_at: '2026-08-10T00:00:00Z' } },
		]
		fetchWorkspacePages.mockResolvedValue(owned)
		fetchSharedPages.mockResolvedValue(shared)
		const result = await fetchRecentPages('user-1', 8)
		expect(ensureWorkspace).toHaveBeenCalledWith('user-1')
		expect(fetchWorkspacePages).toHaveBeenCalledWith('ws-1')
		expect(fetchSharedPages).toHaveBeenCalledWith('user-1')
		expect(result.map(p => p.id)).toEqual(['p-3', 'p-2', 'p-1'])
	})

	it('deduplicates a page owned and shared by the same user', async () => {
		fetchWorkspacePages.mockResolvedValue([{ id: 'p-1', title: 'Mine', updated_at: '2026-08-01T00:00:00Z' }])
		fetchSharedPages.mockResolvedValue([{ role: 'editor', pages: { id: 'p-1', title: 'Mine', updated_at: '2026-08-01T00:00:00Z' } }])
		const result = await fetchRecentPages('user-1', 8)
		expect(result).toHaveLength(1)
	})
})
