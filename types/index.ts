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
	document_id: string | null
	page_id?: string | null
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

export interface Workspace {
	id: string
	name: string
	owner_id: string
	is_team: boolean
	created_at: string
	updated_at: string
}

export interface Page {
	id: string
	workspace_id: string
	parent_id: string | null
	title: string
	owner_id: string
	icon: string | null
	cover: string | null
	properties: Record<string, unknown>
	is_public: boolean
	searchable_text: string | null
	created_at: string
	updated_at: string
}

export interface PageLink {
	id: string
	workspace_id: string
	from_page_id: string
	to_page_id: string | null
	to_title: string
	block_id: string | null
	created_at: string
}

export interface PageTag {
	id: string
	page_id: string
	tag: string
	created_at: string
}

export interface Backlink {
	from_page_id: string
	from_title: string
}

export type MemberRole = 'owner' | 'editor' | 'viewer'

export interface PageMember {
	id: string
	page_id: string
	user_id: string
	role: MemberRole
	created_at: string
	profiles?: { id: string; email: string; full_name: string | null; avatar_url?: string | null }
}

export interface PageInvitation {
	id: string
	page_id: string
	inviter_id: string
	invitee_email: string
	role: 'editor' | 'viewer'
	token: string
	status: 'pending' | 'accepted' | 'declined'
	created_at: string
	pages?: { title: string }
	profiles?: { email: string; full_name: string | null }
}

// Projection returned by invitation queries: every PageInvitation field is
// selected, and the embedded relations come back in array form per the
// PostgREST client's generic inference (normalized to objects at runtime).
export interface PageInvitationProjection extends Omit<PageInvitation, 'pages' | 'profiles'> {
	pages?: { title: string }[]
	profiles?: { email: string; full_name: string | null }[]
}

export interface MemberPageItem {
	role: MemberRole
	pages: Page
}

export interface SearchResult {
	id: string
	title: string
	icon: string | null
	workspace_id: string
	updated_at: string
	surface: 'title' | 'tag' | 'link' | 'content'
	context: string | null
}
