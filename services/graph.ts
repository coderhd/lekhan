import { supabase } from '@/lib/supabase'
import { Backlink, DocumentVersion, MemberPageItem, MemberRole, Page, PageInvitation, PageInvitationProjection, PageLink, PageMember, PageTag, Workspace } from '@/types'
import { getPlanCollaboratorLimit, getUserAICredits } from '@/services/db'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const normalizeInvitation = (row: PageInvitationProjection): PageInvitation => ({
	...row,
	pages: Array.isArray(row.pages) ? row.pages[0] : row.pages,
	profiles: Array.isArray(row.profiles) ? row.profiles[0] : row.profiles,
})

export async function fetchWorkspaces (userId: string): Promise<Workspace[]> {
	const { data, error } = await supabase
		.from('workspaces')
		.select('*')
		.eq('owner_id', userId)
		.order('created_at', { ascending: true })

	if (error) {
		throw error
	}
	return (data as Workspace[]) || []
}

export async function fetchWorkspacePages (workspaceId: string): Promise<Page[]> {
	const { data, error } = await supabase
		.from('pages')
		.select('*')
		.eq('workspace_id', workspaceId)
		.order('updated_at', { ascending: false })

	if (error) {
		throw error
	}
	return (data as Page[]) || []
}

export async function createPage (
	workspaceId: string,
	ownerId: string,
	parentId: string | null = null,
	options: { title?: string; properties?: Record<string, unknown> } = {}
): Promise<Page> {
	const { data, error } = await supabase
		.from('pages')
		.insert({
			workspace_id: workspaceId,
			owner_id: ownerId,
			parent_id: parentId,
			title: options.title ?? 'Untitled',
			...(options.properties ? { properties: options.properties } : {}),
		})
		.select()
		.single()

	if (error) {
		throw error
	}
	return data as Page
}

export async function updatePageTitle (pageId: string, title: string): Promise<void> {
	const { error } = await supabase
		.from('pages')
		.update({ title })
		.eq('id', pageId)

	if (error) {
		throw error
	}
}

export async function deletePage (pageId: string): Promise<void> {
	const { error } = await supabase
		.from('pages')
		.delete()
		.eq('id', pageId)

	if (error) {
		throw error
	}

	// Legacy cutover: also remove the mapped documents row so the deleted
	// page cannot stay reachable through legacy fallback or storage auth.
	const { error: legacyError } = await supabase
		.from('documents')
		.delete()
		.eq('id', pageId)

	if (legacyError) {
		throw legacyError
	}
}

export async function updatePagePublicStatus (pageId: string, isPublic: boolean): Promise<void> {
	const { error } = await supabase
		.from('pages')
		.update({ is_public: isPublic })
		.eq('id', pageId)

	if (error) {
		throw error
	}

	// Mirror to the legacy documents row (same id) so anon access granted by
	// documents.is_public stays in sync with pages.is_public.
	const { error: documentsError } = await supabase
		.from('documents')
		.update({ is_public: isPublic })
		.eq('id', pageId)

	if (documentsError) {
		throw documentsError
	}
}

export async function fetchPageDetails (pageId: string): Promise<Page> {
	const { data, error } = await supabase
		.from('pages')
		.select('*')
		.eq('id', pageId)
		.single()

	if (error) {
		throw error
	}
	return data as Page
}

export async function fetchPageBacklinks (pageId: string): Promise<Backlink[]> {
	const { data, error } = await supabase
		.from('page_links')
		.select('from_page_id, pages!page_links_from_page_id_fkey (title)')
		.eq('to_page_id', pageId)

	if (error) {
		throw error
	}
	return ((data as unknown as Array<{ from_page_id: string; pages: { title: string } | null; from_title?: string }>) || [])
		.filter(row => row.pages || row.from_title)
		.map(row => ({
			from_page_id: row.from_page_id,
			from_title: row.pages ? row.pages.title : (row.from_title as string),
		}))
}

export async function fetchPageTags (pageId: string): Promise<PageTag[]> {
	const { data, error } = await supabase
		.from('page_tags')
		.select('*')
		.eq('page_id', pageId)
		.order('created_at', { ascending: true })

	if (error) {
		throw error
	}
	return (data as PageTag[]) || []
}

export async function fetchWorkspaceGraph (workspaceId: string): Promise<{ pages: Page[]; links: PageLink[] }> {
	const [pagesResult, linksResult] = await Promise.all([
		supabase.from('pages').select('*').eq('workspace_id', workspaceId),
		supabase.from('page_links').select('*').eq('workspace_id', workspaceId),
	])

	if (pagesResult.error) {
		throw pagesResult.error
	}
	if (linksResult.error) {
		throw linksResult.error
	}
	return {
		pages: (pagesResult.data as Page[]) || [],
		links: (linksResult.data as PageLink[]) || [],
	}
}

export async function ensureWorkspace (userId: string): Promise<Workspace> {
	const { data: existing, error: fetchError } = await supabase
		.from('workspaces')
		.select('*')
		.eq('owner_id', userId)
		.maybeSingle()

	if (fetchError) {
		throw fetchError
	}
	if (existing) {
		return existing as Workspace
	}

	const { data, error } = await supabase
		.from('workspaces')
		.insert({ owner_id: userId })
		.select()
		.single()

	if (error && error.code !== '23505') {
		throw error
	}
	if (data) {
		return data as Workspace
	}

	// 23505: another tab created the workspace first — fetch it.
	const { data: retry, error: retryError } = await supabase
		.from('workspaces')
		.select('*')
		.eq('owner_id', userId)
		.single()

	if (retryError) {
		throw retryError
	}
	return retry as Workspace
}

export async function fetchSharedPages (userId: string): Promise<MemberPageItem[]> {
	const { data, error } = await supabase
		.from('page_members')
		.select('role, pages (*)')
		.eq('user_id', userId)

	if (error) {
		throw error
	}
	return (data as unknown as MemberPageItem[]) || []
}

export async function fetchPageMemberRole (pageId: string, userId: string): Promise<MemberRole | null> {
	const { data, error } = await supabase
		.from('page_members')
		.select('role')
		.eq('page_id', pageId)
		.eq('user_id', userId)
		.single()

	if (error) {
		return null
	}
	return data ? (data.role as MemberRole) : null
}

export async function fetchPageMembers (pageId: string): Promise<PageMember[]> {
	const { data, error } = await supabase
		.from('page_members')
		.select('*, profiles:user_id (id, email, full_name, avatar_url)')
		.eq('page_id', pageId)
		.order('created_at', { ascending: true })

	if (error) {
		throw error
	}
	return (data as unknown as PageMember[]) || []
}

export async function removePageMember (pageId: string, userId: string): Promise<void> {
	const { error } = await supabase
		.from('page_members')
		.delete()
		.eq('page_id', pageId)
		.eq('user_id', userId)

	if (error) {
		throw error
	}
}

export async function updatePageMemberRole (pageId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
	const { error } = await supabase
		.from('page_members')
		.update({ role })
		.eq('page_id', pageId)
		.eq('user_id', userId)

	if (error) {
		throw error
	}
}

export class CollaboratorLimitError extends Error {
	readonly code = 'COLLABORATOR_LIMIT_REACHED'
	constructor (message: string) {
		super(message)
		this.name = 'CollaboratorLimitError'
	}
}

export async function createPageInvitation (
	pageId: string,
	inviterId: string,
	inviteeEmail: string,
	role: 'editor' | 'viewer',
	token: string
): Promise<void> {
	const pageDetails = await fetchPageDetails(pageId)
	const ownerCredits = await getUserAICredits(pageDetails.owner_id)
	const allowedLimit = getPlanCollaboratorLimit(ownerCredits.plan)

	const { count: memberCount, error: memberError } = await supabase
		.from('page_members')
		.select('*', { count: 'exact', head: true })
		.eq('page_id', pageId)
	if (memberError) {
		throw memberError
	}

	const { count: inviteCount, error: inviteError } = await supabase
		.from('page_invitations')
		.select('*', { count: 'exact', head: true })
		.eq('page_id', pageId)
		.eq('status', 'pending')
	if (inviteError) {
		throw inviteError
	}

	const totalCount = (memberCount || 0) + (inviteCount || 0)

	if (totalCount >= allowedLimit) {
		throw new CollaboratorLimitError(`Collaborator limit reached for page owner's ${ownerCredits.plan.toUpperCase()} plan (max ${allowedLimit}). Upgrade plan to add more collaborators.`)
	}

	const { error } = await supabase
		.from('page_invitations')
		.insert({
			page_id: pageId,
			inviter_id: inviterId,
			invitee_email: inviteeEmail,
			role,
			token,
			status: 'pending',
		})

	if (error) {
		throw error
	}
}

export async function fetchPendingPageInvitations (email: string): Promise<PageInvitation[]> {
	const { data, error } = await supabase
		.from('page_invitations')
		.select(`
			id,
			page_id,
			inviter_id,
			invitee_email,
			role,
			token,
			status,
			created_at,
			pages (title),
			profiles:inviter_id (email, full_name)
		`)
		.eq('invitee_email', email)
		.eq('status', 'pending')

	if (error) {
		throw error
	}
	return (data as PageInvitationProjection[]).map(normalizeInvitation) || []
}

export async function acceptPageInvitation (invite: PageInvitation, userId: string): Promise<void> {
	if (invite.status !== 'pending') {
		throw new Error('This invitation is no longer available')
	}

	const pageDetails = await fetchPageDetails(invite.page_id)
	const ownerCredits = await getUserAICredits(pageDetails.owner_id)
	const allowedLimit = getPlanCollaboratorLimit(ownerCredits.plan)

	const { count: memberCount, error: memberError } = await supabase
		.from('page_members')
		.select('*', { count: 'exact', head: true })
		.eq('page_id', invite.page_id)
	if (memberError) {
		throw memberError
	}

	// Count other pending invites, excluding the one being accepted, so the
	// invitee's own pending row is not double-counted against the limit.
	const { count: inviteCount, error: inviteError } = await supabase
		.from('page_invitations')
		.select('*', { count: 'exact', head: true })
		.eq('page_id', invite.page_id)
		.eq('status', 'pending')
		.neq('id', invite.id)
	if (inviteError) {
		throw inviteError
	}

	if ((memberCount || 0) + (inviteCount || 0) >= allowedLimit) {
		throw new Error(`Collaborator limit reached for this page's owner (${ownerCredits.plan.toUpperCase()} plan, max ${allowedLimit}).`)
	}

	const { error: memberError2 } = await supabase
		.from('page_members')
		.insert({
			page_id: invite.page_id,
			user_id: userId,
			role: invite.role,
		})

	if (memberError2 && !memberError2.message.includes('duplicate key')) {
		throw memberError2
	}

	const { error: inviteError2 } = await supabase
		.from('page_invitations')
		.update({ status: 'accepted' })
		.eq('id', invite.id)

	if (inviteError2) {
		throw inviteError2
	}
}

export async function declinePageInvitation (inviteId: string): Promise<void> {
	const { error } = await supabase
		.from('page_invitations')
		.update({ status: 'declined' })
		.eq('id', inviteId)

	if (error) {
		throw error
	}
}

export async function fetchPageInvitationDetails (token: string): Promise<PageInvitation> {
	const { data, error } = await supabase
		.from('page_invitations')
		.select(`
			id,
			page_id,
			inviter_id,
			invitee_email,
			role,
			token,
			status,
			created_at,
			pages (title),
			profiles:inviter_id (email, full_name)
		`)
		.eq('token', token)
		.single()

	if (error) {
		throw error
	}
	return normalizeInvitation(data as PageInvitationProjection)
}

export async function fetchMentionablePageCollaborators (pageId: string): Promise<Array<{ id: string; email: string; full_name: string; avatar_url?: string }>> {
	const { data: pageData, error: pageError } = await supabase
		.from('pages')
		.select('owner_id, profiles:owner_id (id, email, full_name, avatar_url)')
		.eq('id', pageId)
		.single()

	if (pageError) throw pageError

	const { data: memberData, error: memberError } = await supabase
		.from('page_members')
		.select('role, profiles:user_id (id, email, full_name, avatar_url)')
		.eq('page_id', pageId)
		.in('role', ['editor'])

	if (memberError) throw memberError

	const collaboratorsMap = new Map<string, { id: string; email: string; full_name: string; avatar_url?: string }>()

	const ownerProfile = pageData?.profiles as unknown as { id: string; email: string; full_name?: string; avatar_url?: string }
	if (ownerProfile && ownerProfile.id) {
		collaboratorsMap.set(ownerProfile.id, {
			id: ownerProfile.id,
			email: ownerProfile.email,
			full_name: ownerProfile.full_name || ownerProfile.email,
			avatar_url: ownerProfile.avatar_url,
		})
	}

	for (const m of (memberData || [])) {
		const profile = m.profiles as unknown as { id: string; email: string; full_name?: string; avatar_url?: string }
		if (profile && profile.id && !collaboratorsMap.has(profile.id)) {
			collaboratorsMap.set(profile.id, {
				id: profile.id,
				email: profile.email,
				full_name: profile.full_name || profile.email,
				avatar_url: profile.avatar_url,
			})
		}
	}

	return Array.from(collaboratorsMap.values())
}

export async function fetchOwnedPagesWithMembers (userId: string): Promise<(Page & { page_members: PageMember[] })[]> {
	const { data, error } = await supabase
		.from('pages')
		.select(`
			*,
			page_members (
				id,
				user_id,
				role,
				profiles:user_id (email, full_name)
			)
		`)
		.eq('owner_id', userId)
		.order('updated_at', { ascending: false })

	if (error) {
		throw error
	}
	return (data || []) as (Page & { page_members: PageMember[] })[]
}

export async function fetchVersionsForEntity (entityId: string): Promise<DocumentVersion[]> {
	if (!UUID_PATTERN.test(entityId)) {
		return []
	}

	const { data, error } = await supabase
		.from('document_versions')
		.select(`
			id,
			document_id,
			page_id,
			version_name,
			created_at,
			created_by,
			profiles:created_by (email, full_name)
		`)
		.or(`page_id.eq.${entityId},document_id.eq.${entityId}`)
		.order('created_at', { ascending: false })

	if (error) {
		throw error
	}
	return (data as unknown as DocumentVersion[]) || []
}