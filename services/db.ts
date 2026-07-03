import { supabase } from '@/lib/supabase'
import {
	DocumentItem,
	MemberDocumentItem,
	DocumentInvitation,
	DocumentVersion,
} from '@/types'

export async function fetchOwnedDocuments (userId: string): Promise<DocumentItem[]> {
	const { data, error } = await supabase
		.from('documents')
		.select('*')
		.eq('owner_id', userId)
		.order('updated_at', { ascending: false })

	if (error) {
		throw error
	}
	return (data as DocumentItem[]) || []
}

export async function fetchSharedDocuments (userId: string): Promise<MemberDocumentItem[]> {
	const { data, error } = await supabase
		.from('document_members')
		.select('role, documents (*)')
		.eq('user_id', userId)

	if (error) {
		throw error
	}
	return (data as any[]) || []
}

export async function createDocument (ownerId: string): Promise<DocumentItem> {
	const { data, error } = await supabase
		.from('documents')
		.insert({
			title: 'Untitled Document',
			owner_id: ownerId,
		})
		.select()
		.single()

	if (error) {
		throw error
	}
	return data as DocumentItem
}

export async function updateDocumentTitle (documentId: string, title: string): Promise<void> {
	const { error } = await supabase
		.from('documents')
		.update({ title })
		.eq('id', documentId)

	if (error) {
		throw error
	}
}

export async function updateDocumentPublicStatus (documentId: string, isPublic: boolean): Promise<void> {
	const { error } = await supabase
		.from('documents')
		.update({ is_public: isPublic })
		.eq('id', documentId)

	if (error) {
		throw error
	}
}

export async function fetchDocumentDetails (documentId: string): Promise<{ title: string; owner_id: string; is_public: boolean }> {
	const { data, error } = await supabase
		.from('documents')
		.select('title, owner_id, is_public')
		.eq('id', documentId)
		.single()

	if (error) {
		throw error
	}
	return data as { title: string; owner_id: string; is_public: boolean }
}

export async function fetchPendingInvitations (email: string): Promise<DocumentInvitation[]> {
	const { data, error } = await supabase
		.from('document_invitations')
		.select(`
			id,
			document_id,
			role,
			inviter_id,
			invitee_email,
			documents (title),
			profiles:inviter_id (email, full_name)
		`)
		.eq('invitee_email', email)
		.eq('status', 'pending')

	if (error) {
		throw error
	}
	return (data as any[]) || []
}

export async function acceptInvitation (invite: DocumentInvitation, userId: string): Promise<void> {
	const { error: memberError } = await supabase
		.from('document_members')
		.insert({
			document_id: invite.document_id,
			user_id: userId,
			role: invite.role,
		})

	if (memberError && !memberError.message.includes('duplicate key')) {
		throw memberError
	}

	const { error: inviteError } = await supabase
		.from('document_invitations')
		.update({ status: 'accepted' })
		.eq('id', invite.id)

	if (inviteError) {
		throw inviteError
	}
}

export async function declineInvitation (inviteId: string): Promise<void> {
	const { error } = await supabase
		.from('document_invitations')
		.update({ status: 'declined' })
		.eq('id', inviteId)

	if (error) {
		throw error
	}
}

export async function createInvitation (
	documentId: string,
	inviterId: string,
	inviteeEmail: string,
	role: 'editor' | 'viewer',
	token: string
): Promise<void> {
	const { error } = await supabase
		.from('document_invitations')
		.insert({
			document_id: documentId,
			inviter_id: inviterId,
			invitee_email: inviteeEmail,
			role: role,
			token: token,
			status: 'pending',
		})

	if (error) {
		throw error
	}
}

export async function fetchInvitationDetails (token: string): Promise<DocumentInvitation> {
	const { data, error } = await supabase
		.from('document_invitations')
		.select(`
			id,
			document_id,
			role,
			status,
			documents (title),
			profiles:inviter_id (email, full_name)
		`)
		.eq('token', token)
		.single()

	if (error) {
		throw error
	}
	return data as any as DocumentInvitation
}

export async function fetchVersions (documentId: string): Promise<DocumentVersion[]> {
	const { data, error } = await supabase
		.from('document_versions')
		.select(`
			id,
			document_id,
			version_name,
			created_at,
			created_by,
			profiles:created_by (email, full_name)
		`)
		.eq('document_id', documentId)
		.order('created_at', { ascending: false })

	if (error) {
		throw error
	}
	return (data as any[]) || []
}

export async function fetchMemberRole (documentId: string, userId: string): Promise<'editor' | 'viewer' | null> {
	const { data, error } = await supabase
		.from('document_members')
		.select('role')
		.eq('document_id', documentId)
		.eq('user_id', userId)
		.single()

	if (error) {
		return null
	}
	return data ? (data.role as 'editor' | 'viewer') : null
}
