export interface Profile {
	id: string
	email: string
	full_name: string | null
}

export interface DocumentItem {
	id: string
	title: string
	owner_id: string
	is_public: boolean
	searchable_text: string | null
	created_at: string
	updated_at: string
}

export interface DocumentMember {
	id: string
	document_id: string
	user_id: string
	role: 'editor' | 'viewer'
}

export interface MemberDocumentItem {
	role: 'editor' | 'viewer'
	documents: DocumentItem
}

export interface DocumentInvitation {
	id: string
	document_id: string
	inviter_id: string
	invitee_email: string
	role: 'editor' | 'viewer'
	token: string
	status: 'pending' | 'accepted' | 'declined'
	created_at: string
	documents?: { title: string }
	profiles?: { email: string; full_name: string | null }
}

export interface DocumentVersion {
	id: string
	document_id: string
	version_name: string
	created_at: string
	created_by: string
	profiles?: { email: string; full_name: string | null }
}

export interface CollabUser {
	id: string
	name: string
	color: string
}
