import { vi, describe, it, expect, beforeEach } from 'vitest'
import { supabase } from '@/lib/supabase'
import {
	fetchWorkspaces,
	fetchWorkspacePages,
	createPage,
	updatePageTitle,
	deletePage,
	updatePagePublicStatus,
	fetchPageDetails,
	fetchPageBacklinks,
	fetchPageTags,
	fetchWorkspaceGraph,
} from '@/services/graph'

vi.mock('@/lib/supabase', () => {
	const builder: any = {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue({ data: null, error: null }),
		then: vi.fn((cb) => Promise.resolve({ data: [], count: 0, error: null }).then(cb)),
	}
	return {
		supabase: {
			from: vi.fn(() => builder),
		},
	}
})

describe('Graph Service', () => {
	const mockBuilder = (supabase.from as any)()

	beforeEach(() => {
		vi.clearAllMocks()
		mockBuilder.select.mockReturnThis()
		mockBuilder.insert.mockReturnThis()
		mockBuilder.update.mockReturnThis()
		mockBuilder.delete.mockReturnThis()
		mockBuilder.eq.mockReturnThis()
		mockBuilder.order.mockReturnThis()
		mockBuilder.single.mockResolvedValue({ data: null, error: null })
		mockBuilder.then.mockImplementation((cb: any) => Promise.resolve({ data: [], count: 0, error: null }).then(cb))
	})

	it('fetchWorkspaces queries workspaces by owner', async () => {
		const mockWorkspaces = [{ id: 'ws-1', name: 'My Workspace', owner_id: 'user-123' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockWorkspaces, error: null }).then(onfulfilled)
		)
		const result = await fetchWorkspaces('user-123')
		expect(supabase.from).toHaveBeenCalledWith('workspaces')
		expect(mockBuilder.eq).toHaveBeenCalledWith('owner_id', 'user-123')
		expect(result).toEqual(mockWorkspaces)
	})

	it('fetchWorkspacePages queries pages by workspace', async () => {
		const mockPages = [{ id: 'p-1', workspace_id: 'ws-1', title: 'A' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockPages, error: null }).then(onfulfilled)
		)
		const result = await fetchWorkspacePages('ws-1')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.eq).toHaveBeenCalledWith('workspace_id', 'ws-1')
		expect(result).toEqual(mockPages)
	})

	it('createPage inserts a page with workspace and owner', async () => {
		const newPage = { id: 'p-2', workspace_id: 'ws-1', owner_id: 'user-123', title: 'Untitled' }
		mockBuilder.single.mockResolvedValue({ data: newPage, error: null })
		const result = await createPage('ws-1', 'user-123')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.insert).toHaveBeenCalledWith({
			workspace_id: 'ws-1',
			owner_id: 'user-123',
			parent_id: null,
			title: 'Untitled',
		})
		expect(result).toEqual(newPage)
	})

	it('createPage passes parent_id when provided', async () => {
		mockBuilder.single.mockResolvedValue({ data: { id: 'p-3' }, error: null })
		await createPage('ws-1', 'user-123', 'parent-9')
		expect(mockBuilder.insert).toHaveBeenCalledWith({
			workspace_id: 'ws-1',
			owner_id: 'user-123',
			parent_id: 'parent-9',
			title: 'Untitled',
		})
	})

	it('updatePageTitle updates the page title', async () => {
		await updatePageTitle('p-1', 'New Title')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.update).toHaveBeenCalledWith({ title: 'New Title' })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'p-1')
	})

	it('deletePage deletes the page', async () => {
		await deletePage('p-1')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.delete).toHaveBeenCalled()
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'p-1')
	})

	it('updatePagePublicStatus updates is_public', async () => {
		await updatePagePublicStatus('p-1', true)
		expect(mockBuilder.update).toHaveBeenCalledWith({ is_public: true })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'p-1')
	})

	it('fetchPageDetails fetches a single page', async () => {
		const page = { id: 'p-1', workspace_id: 'ws-1', title: 'A' }
		mockBuilder.single.mockResolvedValue({ data: page, error: null })
		const result = await fetchPageDetails('p-1')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'p-1')
		expect(result).toEqual(page)
	})

	it('fetchPageBacklinks returns pages linking to the given page', async () => {
		const mockBacklinks = [{ from_page_id: 'p-9', from_title: 'Source' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockBacklinks, error: null }).then(onfulfilled)
		)
		const result = await fetchPageBacklinks('p-1')
		expect(supabase.from).toHaveBeenCalledWith('page_links')
		expect(result).toEqual(mockBacklinks)
	})

	it('fetchPageTags returns tags for a page', async () => {
		const mockTags = [{ id: 't-1', page_id: 'p-1', tag: 'work' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockTags, error: null }).then(onfulfilled)
		)
		const result = await fetchPageTags('p-1')
		expect(supabase.from).toHaveBeenCalledWith('page_tags')
		expect(mockBuilder.eq).toHaveBeenCalledWith('page_id', 'p-1')
		expect(result).toEqual(mockTags)
	})

	it('fetchWorkspaceGraph fetches pages and links together', async () => {
		const mockPages = [{ id: 'p-1' }]
		const mockLinks = [{ from_page_id: 'p-1', to_title: 'A' }]
		mockBuilder.then
			.mockImplementationOnce((onfulfilled: any) =>
				Promise.resolve({ data: mockPages, error: null }).then(onfulfilled)
			)
			.mockImplementationOnce((onfulfilled: any) =>
				Promise.resolve({ data: mockLinks, error: null }).then(onfulfilled)
			)
		const result = await fetchWorkspaceGraph('ws-1')
		expect(result).toEqual({ pages: mockPages, links: mockLinks })
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(supabase.from).toHaveBeenCalledWith('page_links')
	})
})