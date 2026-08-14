import { vi, describe, it, expect, beforeEach } from 'vitest'
import { supabase } from '@/lib/supabase'
import { PageInvitation } from '@/types'
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
	ensureWorkspace,
	fetchSharedPages,
	fetchPageMemberRole,
	fetchPageMembers,
	removePageMember,
	updatePageMemberRole,
	createPageInvitation,
	fetchPendingPageInvitations,
	acceptPageInvitation,
	declinePageInvitation,
	fetchPageInvitationDetails,
	fetchMentionablePageCollaborators,
	fetchOwnedPagesWithMembers,
	fetchVersionsForEntity,
} from '@/services/graph'

vi.mock('@/lib/supabase', () => {
	const builder: any = {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		in: vi.fn().mockReturnThis(),
		neq: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		or: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue({ data: null, error: null }),
		maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
		then: vi.fn((cb) => Promise.resolve({ data: [], count: 0, error: null }).then(cb)),
	}
	return {
		supabase: {
			from: vi.fn(() => builder),
		},
	}
})

const mockBuilder = (supabase.from as any)()

describe('Graph Service', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockBuilder.select.mockReturnThis()
		mockBuilder.insert.mockReturnThis()
		mockBuilder.update.mockReturnThis()
		mockBuilder.delete.mockReturnThis()
		mockBuilder.eq.mockReturnThis()
		mockBuilder.in.mockReturnThis()
		mockBuilder.order.mockReturnThis()
		mockBuilder.or.mockReturnThis()
		mockBuilder.single.mockResolvedValue({ data: null, error: null })
		mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null })
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

	it('deletePage deletes the page and its mapped legacy documents row', async () => {
		await deletePage('p-1')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(supabase.from).toHaveBeenCalledWith('documents')
		expect(mockBuilder.delete).toHaveBeenCalled()
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'p-1')
	})

	it('updatePagePublicStatus mirrors is_public to pages and documents', async () => {
		await updatePagePublicStatus('p-1', true)
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(supabase.from).toHaveBeenCalledWith('documents')
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

describe('Graph Service P2 additions', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('ensureWorkspace returns an existing workspace', async () => {
		const ws = { id: 'ws-1', name: 'My Workspace', owner_id: 'user-123', is_team: false, created_at: '', updated_at: '' }
		mockBuilder.maybeSingle.mockResolvedValue({ data: ws, error: null })
		const result = await ensureWorkspace('user-123')
		expect(supabase.from).toHaveBeenCalledWith('workspaces')
		expect(mockBuilder.eq).toHaveBeenCalledWith('owner_id', 'user-123')
		expect(result).toEqual(ws)
	})

	it('ensureWorkspace inserts a workspace when none exists', async () => {
		mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null })
		mockBuilder.single.mockResolvedValue({ data: { id: 'ws-2', owner_id: 'user-123' }, error: null })
		const result = await ensureWorkspace('user-123')
		expect(mockBuilder.insert).toHaveBeenCalledWith({ owner_id: 'user-123' })
		expect(result).toEqual({ id: 'ws-2', owner_id: 'user-123' })
	})

	it('ensureWorkspace refetches when a concurrent insert hits a unique violation', async () => {
		mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null })
		mockBuilder.single
			.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
			.mockResolvedValueOnce({ data: { id: 'ws-3', owner_id: 'user-123' }, error: null })
		const result = await ensureWorkspace('user-123')
		expect(result).toEqual({ id: 'ws-3', owner_id: 'user-123' })
	})

	it('fetchSharedPages queries page_members with page embed', async () => {
		const shared = [{ role: 'editor', pages: { id: 'p-1', title: 'A' } }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: shared, error: null }).then(onfulfilled)
		)
		const result = await fetchSharedPages('user-123')
		expect(supabase.from).toHaveBeenCalledWith('page_members')
		expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', 'user-123')
		expect(result).toEqual(shared)
	})

	it('fetchPageMemberRole returns the role for a member', async () => {
		mockBuilder.single.mockResolvedValue({ data: { role: 'viewer' }, error: null })
		const role = await fetchPageMemberRole('p-1', 'user-123')
		expect(supabase.from).toHaveBeenCalledWith('page_members')
		expect(role).toBe('viewer')
	})

	it('fetchPageMemberRole returns null on error', async () => {
		mockBuilder.single.mockResolvedValue({ data: null, error: { message: 'no rows' } })
		const role = await fetchPageMemberRole('p-1', 'user-123')
		expect(role).toBeNull()
	})

	it('fetchPageMembers returns members with profile embed', async () => {
		const members = [{ id: 'm-1', page_id: 'p-1', user_id: 'u-1', role: 'editor' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: members, error: null }).then(onfulfilled)
		)
		const result = await fetchPageMembers('p-1')
		expect(supabase.from).toHaveBeenCalledWith('page_members')
		expect(mockBuilder.eq).toHaveBeenCalledWith('page_id', 'p-1')
		expect(result).toEqual(members)
	})

	it('removePageMember deletes the membership', async () => {
		await removePageMember('p-1', 'u-9')
		expect(supabase.from).toHaveBeenCalledWith('page_members')
		expect(mockBuilder.delete).toHaveBeenCalled()
		expect(mockBuilder.eq).toHaveBeenCalledWith('page_id', 'p-1')
		expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', 'u-9')
	})

	it('updatePageMemberRole updates the role', async () => {
		await updatePageMemberRole('p-1', 'u-9', 'viewer')
		expect(mockBuilder.update).toHaveBeenCalledWith({ role: 'viewer' })
		expect(mockBuilder.eq).toHaveBeenCalledWith('page_id', 'p-1')
		expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', 'u-9')
	})

	it('createPageInvitation counts members and pending invites against the plan limit', async () => {
		mockBuilder.single.mockResolvedValue({ data: { id: 'p-1', owner_id: 'owner-1' }, error: null })
		let counts = 0
		mockBuilder.then.mockImplementation((onfulfilled: any) =>
			Promise.resolve({ data: [], count: counts++, error: null }).then(onfulfilled)
		)
		await createPageInvitation('p-1', 'owner-1', 'x@test.com', 'viewer', 'tok-1')
		expect(supabase.from).toHaveBeenCalledWith('page_invitations')
		expect(mockBuilder.insert).toHaveBeenCalledWith({
			page_id: 'p-1',
			inviter_id: 'owner-1',
			invitee_email: 'x@test.com',
			role: 'viewer',
			token: 'tok-1',
			status: 'pending',
		})
	})

	it('createPageInvitation rejects at the collaborator limit without inserting', async () => {
		mockBuilder.single.mockResolvedValue({ data: { id: 'p-1', owner_id: 'owner-1' }, error: null })
		mockBuilder.then
			.mockImplementationOnce((onfulfilled: any) =>
				Promise.resolve({ data: [], count: 2, error: null }).then(onfulfilled)
			)
			.mockImplementationOnce((onfulfilled: any) =>
				Promise.resolve({ data: [], count: 0, error: null }).then(onfulfilled)
			)
		await expect(createPageInvitation('p-1', 'owner-1', 'x@test.com', 'viewer', 'tok-1')).rejects.toThrow('Collaborator limit reached')
		expect(mockBuilder.insert).not.toHaveBeenCalled()
	})

	it('createPageInvitation propagates precheck failures without inserting', async () => {
		mockBuilder.single.mockResolvedValue({ data: null, error: { message: 'page fetch failed' } })
		await expect(createPageInvitation('p-1', 'owner-1', 'x@test.com', 'viewer', 'tok-1')).rejects.toThrow('page fetch failed')
		expect(mockBuilder.insert).not.toHaveBeenCalled()
	})

	it('fetchPendingPageInvitations filters by email and pending status', async () => {
		const invites = [{ id: 'i-1', page_id: 'p-1', role: 'editor' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: invites, error: null }).then(onfulfilled)
		)
		const result = await fetchPendingPageInvitations('x@test.com')
		expect(supabase.from).toHaveBeenCalledWith('page_invitations')
		expect(mockBuilder.eq).toHaveBeenCalledWith('invitee_email', 'x@test.com')
		expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'pending')
		expect(result).toEqual(invites)
	})

	it('acceptPageInvitation inserts a member then marks the invite accepted', async () => {
		const invite = { id: 'i-1', page_id: 'p-1', role: 'editor', status: 'pending' } as PageInvitation
		mockBuilder.single.mockResolvedValue({ data: { id: 'p-1', owner_id: 'owner-1' }, error: null })
		mockBuilder.then.mockImplementation((onfulfilled: any) =>
			Promise.resolve({ data: [], count: 0, error: null }).then(onfulfilled)
		)
		await acceptPageInvitation(invite, 'user-123')
		expect(mockBuilder.insert).toHaveBeenCalledWith({ page_id: 'p-1', user_id: 'user-123', role: 'editor' })
		expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'accepted' })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'i-1')
	})

	it('acceptPageInvitation rejects a non-pending invite without inserting', async () => {
		const invite = { id: 'i-1', page_id: 'p-1', role: 'editor', status: 'declined' } as PageInvitation
		await expect(acceptPageInvitation(invite, 'user-123')).rejects.toThrow('This invitation is no longer available')
		expect(mockBuilder.insert).not.toHaveBeenCalled()
		expect(mockBuilder.update).not.toHaveBeenCalled()
	})

	it('acceptPageInvitation rejects at the collaborator limit without inserting', async () => {
		const invite = { id: 'i-1', page_id: 'p-1', role: 'editor', status: 'pending' } as PageInvitation
		mockBuilder.single.mockResolvedValue({ data: { id: 'p-1', owner_id: 'owner-1' }, error: null })
		mockBuilder.then
			.mockImplementationOnce((onfulfilled: any) =>
				Promise.resolve({ data: [], count: 2, error: null }).then(onfulfilled)
			)
			.mockImplementationOnce((onfulfilled: any) =>
				Promise.resolve({ data: [], count: 0, error: null }).then(onfulfilled)
			)
		await expect(acceptPageInvitation(invite, 'user-123')).rejects.toThrow('Collaborator limit reached')
		expect(mockBuilder.insert).not.toHaveBeenCalled()
		expect(mockBuilder.update).not.toHaveBeenCalled()
	})

	it('acceptPageInvitation propagates count-query failures without inserting', async () => {
		const invite = { id: 'i-1', page_id: 'p-1', role: 'editor', status: 'pending' } as PageInvitation
		mockBuilder.single.mockResolvedValue({ data: { id: 'p-1', owner_id: 'owner-1' }, error: null })
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: [], count: null, error: { message: 'count failed' } }).then(onfulfilled)
		)
		await expect(acceptPageInvitation(invite, 'user-123')).rejects.toThrow('count failed')
		expect(mockBuilder.insert).not.toHaveBeenCalled()
		expect(mockBuilder.update).not.toHaveBeenCalled()
	})

	it('declinePageInvitation marks the invite declined', async () => {
		await declinePageInvitation('i-1')
		expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'declined' })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'i-1')
	})

	it('fetchPageInvitationDetails fetches by token', async () => {
		const invite = { id: 'i-1', page_id: 'p-1', token: 'tok-1' }
		mockBuilder.single.mockResolvedValue({ data: invite, error: null })
		const result = await fetchPageInvitationDetails('tok-1')
		expect(supabase.from).toHaveBeenCalledWith('page_invitations')
		expect(mockBuilder.eq).toHaveBeenCalledWith('token', 'tok-1')
		expect(result).toEqual(invite)
	})

	it('fetchMentionablePageCollaborators returns owner and editor members', async () => {
		mockBuilder.single.mockResolvedValue({
			data: { owner_id: 'owner-1', profiles: { id: 'owner-1', email: 'o@test.com', full_name: 'Owner' } },
			error: null,
		})
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({
				data: [{ role: 'editor', profiles: { id: 'ed-1', email: 'e@test.com', full_name: 'Editor' } }],
				error: null,
			}).then(onfulfilled)
		)
		const result = await fetchMentionablePageCollaborators('p-1')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(supabase.from).toHaveBeenCalledWith('page_members')
		expect(result).toEqual([
			{ id: 'owner-1', email: 'o@test.com', full_name: 'Owner' },
			{ id: 'ed-1', email: 'e@test.com', full_name: 'Editor' },
		])
	})

	it('fetchOwnedPagesWithMembers embeds page members', async () => {
		const pages = [{ id: 'p-1', page_members: [{ id: 'm-1', user_id: 'u-1', role: 'editor' }] }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: pages, error: null }).then(onfulfilled)
		)
		const result = await fetchOwnedPagesWithMembers('user-123')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.eq).toHaveBeenCalledWith('owner_id', 'user-123')
		expect(result).toEqual(pages)
	})

	it('fetchVersionsForEntity queries page_id OR document_id', async () => {
		const entityId = '11111111-1111-4111-8111-111111111111'
		const versions = [{ id: 'v-1', version_name: 'Draft' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: versions, error: null }).then(onfulfilled)
		)
		const result = await fetchVersionsForEntity(entityId)
		expect(supabase.from).toHaveBeenCalledWith('document_versions')
		expect(mockBuilder.or).toHaveBeenCalledWith(`page_id.eq.${entityId},document_id.eq.${entityId}`)
		expect(result).toEqual(versions)
	})

	it('fetchVersionsForEntity rejects a non-UUID id without querying', async () => {
		const result = await fetchVersionsForEntity('p-1')
		expect(result).toEqual([])
		expect(supabase.from).not.toHaveBeenCalledWith('document_versions')
	})
})