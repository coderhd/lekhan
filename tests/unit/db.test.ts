import { vi, describe, it, expect, beforeEach } from 'vitest'
import { supabase } from '@/lib/supabase'
import * as db from '@/services/db'

vi.mock('@/lib/supabase', () => {
	const builder: any = {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
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

describe('Database Queries Service', () => {
	const mockBuilder = (supabase.from as any)()

	beforeEach(() => {
		vi.clearAllMocks()
		mockBuilder.select.mockReturnThis()
		mockBuilder.insert.mockReturnThis()
		mockBuilder.update.mockReturnThis()
		mockBuilder.eq.mockReturnThis()
		mockBuilder.order.mockReturnThis()
		mockBuilder.single.mockResolvedValue({ data: null, error: null })
		mockBuilder.then.mockImplementation((cb: any) => Promise.resolve({ data: [], count: 0, error: null }).then(cb))
	})

	it('fetchOwnedDocuments should fetch owned documents ordered by updated_at', async () => {
		const mockDocs = [{ id: '1', title: 'Doc 1', owner_id: 'user-123' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockDocs, error: null }).then(onfulfilled)
		)

		const result = await db.fetchOwnedDocuments('user-123')
		expect(supabase.from).toHaveBeenCalledWith('documents')
		expect(mockBuilder.select).toHaveBeenCalled()
		expect(mockBuilder.eq).toHaveBeenCalledWith('owner_id', 'user-123')
		expect(mockBuilder.order).toHaveBeenCalledWith('updated_at', { ascending: false })
		expect(result).toEqual(mockDocs)
	})

	it('fetchSharedDocuments should fetch documents shared with the user', async () => {
		const mockShared = [{ role: 'editor', documents: { id: '2', title: 'Shared Doc' } }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockShared, error: null }).then(onfulfilled)
		)

		const result = await db.fetchSharedDocuments('user-123')
		expect(supabase.from).toHaveBeenCalledWith('document_members')
		expect(mockBuilder.select).toHaveBeenCalledWith('role, documents (*)')
		expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', 'user-123')
		expect(result).toEqual(mockShared)
	})

	it('createDocument should insert a new document and return it', async () => {
		const newDoc = { id: '3', title: 'Untitled Document', owner_id: 'user-123' }
		mockBuilder.single.mockResolvedValue({ data: newDoc, error: null })

		const result = await db.createDocument('user-123')
		expect(supabase.from).toHaveBeenCalledWith('documents')
		expect(result).toEqual(newDoc)
	})

	it('updateDocumentTitle should update document title', async () => {
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ error: null }).then(onfulfilled)
		)

		await db.updateDocumentTitle('doc-123', 'New Title')
		expect(supabase.from).toHaveBeenCalledWith('documents')
		expect(mockBuilder.update).toHaveBeenCalledWith({ title: 'New Title' })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'doc-123')
	})

	it('updateDocumentPublicStatus should update public availability status', async () => {
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ error: null }).then(onfulfilled)
		)

		await db.updateDocumentPublicStatus('doc-123', true)
		expect(supabase.from).toHaveBeenCalledWith('documents')
		expect(mockBuilder.update).toHaveBeenCalledWith({ is_public: true })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'doc-123')
	})

	it('fetchDocumentDetails should fetch detailed columns of a document', async () => {
		const docDetails = { title: 'Secret Doc', owner_id: 'user-789', is_public: false }
		mockBuilder.single.mockResolvedValueOnce({ data: docDetails, error: null })

		const result = await db.fetchDocumentDetails('doc-123')
		expect(supabase.from).toHaveBeenCalledWith('documents')
		expect(mockBuilder.select).toHaveBeenCalledWith('title, owner_id, is_public')
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'doc-123')
		expect(result).toEqual(docDetails)
	})

	it('fetchPendingInvitations should retrieve invitations for email', async () => {
		const mockInvites = [{ id: 'inv-1', invitee_email: 'test@ok.com', status: 'pending' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockInvites, error: null }).then(onfulfilled)
		)

		const result = await db.fetchPendingInvitations('test@ok.com')
		expect(supabase.from).toHaveBeenCalledWith('document_invitations')
		expect(result).toEqual(mockInvites)
	})

	it('declineInvitation should set status of invitation to declined', async () => {
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ error: null }).then(onfulfilled)
		)

		await db.declineInvitation('inv-1')
		expect(supabase.from).toHaveBeenCalledWith('document_invitations')
		expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'declined' })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'inv-1')
	})

	it('createInvitation should insert invitation details', async () => {
		mockBuilder.then.mockImplementation((onfulfilled: any) =>
			Promise.resolve({ error: null, count: 0 }).then(onfulfilled)
		)

		await db.createInvitation('doc-1', 'inviter-123', 'invitee@gmail.com', 'editor', 'token-abc')
		expect(supabase.from).toHaveBeenCalledWith('document_invitations')
	})

	it('fetchInvitationDetails should retrieve invitation details by token', async () => {
		const inviteDetails = { id: 'inv-1', document_id: 'doc-1', role: 'editor', status: 'pending' }
		mockBuilder.single.mockResolvedValueOnce({ data: inviteDetails, error: null })

		const result = await db.fetchInvitationDetails('token-abc')
		expect(supabase.from).toHaveBeenCalledWith('document_invitations')
		expect(mockBuilder.eq).toHaveBeenCalledWith('token', 'token-abc')
		expect(result).toEqual(inviteDetails)
	})

	it('fetchVersions should get document version history', async () => {
		const versions = [{ id: 'v-1', version_name: 'v1.0' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: versions, error: null }).then(onfulfilled)
		)

		const result = await db.fetchVersions('doc-1')
		expect(supabase.from).toHaveBeenCalledWith('document_versions')
		expect(mockBuilder.eq).toHaveBeenCalledWith('document_id', 'doc-1')
		expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false })
		expect(result).toEqual(versions)
	})

	it('fetchMemberRole should get user role in document', async () => {
		const memberRole = { role: 'viewer' }
		mockBuilder.single.mockResolvedValueOnce({ data: memberRole, error: null })

		const result = await db.fetchMemberRole('doc-1', 'user-123')
		expect(supabase.from).toHaveBeenCalledWith('document_members')
		expect(result).toBe('viewer')
	})
})
