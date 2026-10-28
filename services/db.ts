import { supabase } from '@/lib/supabase'
import { getPlanLimits } from '@/lib/tier-limits'
import { normalizeLegacyPlan, type NormalizedPlan } from '@/lib/billing/legacy-plan-normalization'
import {
	resolveOwnerWorkspaceEntitlement,
	type WorkspaceEntitlement,
} from '@/lib/billing/entitlements'
import {
	DocumentItem,
	MemberDocumentItem,
	DocumentInvitation,
	DocumentVersion,
} from '@/types'

/**
 * T11 — enforcement source for a document/page owner.
 *
 * Primary source: the owner's `workspace_plans` row (billing root). The
 * deprecated `profiles.plan` mirror is only consulted when the workspace row is
 * not readable through RLS — invitee accept paths resolve the OWNER's plan and
 * cannot see the owner's workspace row. The fallback still passes through
 * `normalizeLegacyPlan` (T2), so a legacy `go` token can never silently reach
 * `getPlanLimits` as FREE_LIMITS (Review Focus 5).
 */
export type OwnerEntitlementSource = 'workspace' | 'legacy-mirror' | 'default'

export interface OwnerEntitlement {
	tier: NormalizedPlan
	seats: number | null
	source: OwnerEntitlementSource
	entitlement: WorkspaceEntitlement | null
}

export async function getOwnerEntitlement (ownerId: string): Promise<OwnerEntitlement> {
	try {
		const entitlement = await resolveOwnerWorkspaceEntitlement(ownerId, supabase)
		if (entitlement) {
			return { tier: entitlement.tier, seats: entitlement.seats, source: 'workspace', entitlement }
		}
	} catch (err) {
		// Never silently grant a paid tier on a failed workspace read; fall through
		// to the normalized mirror so enforcement stays at least pre-cutover-equal.
		console.warn('[entitlements] workspace resolution failed; using normalized mirror:', err)
	}

	try {
		const { data, error } = await supabase
			.from('profiles')
			.select('plan')
			.eq('id', ownerId)
			.maybeSingle()

		if (error) {
			console.warn('[entitlements] legacy mirror read failed; falling back to free:', error.message)
		} else if (data) {
			return {
				tier: normalizeLegacyPlan((data as { plan?: string | null }).plan),
				seats: null,
				source: 'legacy-mirror',
				entitlement: null,
			}
		}
	} catch (err) {
		console.warn('[entitlements] legacy mirror read failed; falling back to free:', err)
	}

	return { tier: 'free', seats: null, source: 'default', entitlement: null }
}

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
	return (data as unknown as MemberDocumentItem[]) || []
}

export async function createDocument (ownerId: string): Promise<DocumentItem> {
	const userCredits = await getUserAICredits(ownerId)
	const ownedDocs = await fetchOwnedDocuments(ownerId)
	const maxDocs = getPlanMaxDocuments(userCredits.plan)

	if (ownedDocs.length >= maxDocs) {
		throw new Error(`Maximum document limit (${maxDocs}) reached for your ${userCredits.plan.toUpperCase()} plan. Please upgrade to Go or Pro for unlimited documents.`)
	}

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

export async function deleteDocument (documentId: string): Promise<void> {
	const { error } = await supabase
		.from('documents')
		.delete()
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
	return (data as unknown as DocumentInvitation[]) || []
}

export async function acceptInvitation (invite: DocumentInvitation, userId: string): Promise<void> {
	try {
		const docDetails = await fetchDocumentDetails(invite.document_id)
		const ownerEntitlement = await getOwnerEntitlement(docDetails.owner_id)
		const allowedLimit = getPlanLimits(ownerEntitlement.tier, ownerEntitlement.seats).maxDistinctCollaborators

		const { count: memberCount } = await supabase
			.from('document_members')
			.select('*', { count: 'exact', head: true })
			.eq('document_id', invite.document_id)

		if ((memberCount || 0) >= allowedLimit) {
			throw new Error(`Collaborator limit reached for this document's owner (${ownerEntitlement.tier.toUpperCase()} plan, max ${allowedLimit}).`)
		}
	} catch (e: any) {
		if (e.message && e.message.includes('Collaborator limit reached')) {
			throw e
		}
	}

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
	try {
		const docDetails = await fetchDocumentDetails(documentId)
		const ownerEntitlement = await getOwnerEntitlement(docDetails.owner_id)
		const allowedLimit = getPlanLimits(ownerEntitlement.tier, ownerEntitlement.seats).maxDistinctCollaborators

		const { count: memberCount } = await supabase
			.from('document_members')
			.select('*', { count: 'exact', head: true })
			.eq('document_id', documentId)

		const { count: inviteCount } = await supabase
			.from('document_invitations')
			.select('*', { count: 'exact', head: true })
			.eq('document_id', documentId)
			.eq('status', 'pending')

		const totalCount = (memberCount || 0) + (inviteCount || 0)

		if (totalCount >= allowedLimit) {
			throw new Error(`Collaborator limit reached for document owner's ${ownerEntitlement.tier.toUpperCase()} plan (max ${allowedLimit}). Upgrade plan to add more collaborators.`)
		}
	} catch (e: any) {
		if (e.message && e.message.includes('Collaborator limit reached')) {
			throw e
		}
	}

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
	return data as unknown as DocumentInvitation
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
	return (data as unknown as DocumentVersion[]) || []
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

export async function fetchOwnedDocumentsWithMembers (userId: string): Promise<(DocumentItem & { document_members: any[] })[]> {
	const { data, error } = await supabase
		.from('documents')
		.select(`
			*,
			document_members (
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
	return data || []
}

export async function fetchPastCollaborators (userId: string): Promise<{email: string; full_name: string}[]> {
	const { data: docs, error: docsError } = await supabase
		.from('documents')
		.select('id')
		.eq('owner_id', userId)

	if (docsError) throw docsError
	
	if (!docs || docs.length === 0) return []

	const docIds = docs.map(d => d.id)

	const { data: members, error: membersError } = await supabase
		.from('document_members')
		.select('profiles:user_id (email, full_name)')
		.in('document_id', docIds)

	if (membersError) throw membersError

	const uniqueMap = new Map<string, {email: string; full_name: string}>()
	for (const m of (members || [])) {
		const profile = m.profiles as unknown as {email: string; full_name: string | null}
		if (profile && profile.email) {
			uniqueMap.set(profile.email, {
				email: profile.email,
				full_name: profile.full_name || profile.email
			})
		}
	}

	return Array.from(uniqueMap.values())
}

export async function removeDocumentMember (documentId: string, userId: string): Promise<void> {
	const { error } = await supabase
		.from('document_members')
		.delete()
		.eq('document_id', documentId)
		.eq('user_id', userId)

	if (error) throw error
}

export async function fetchMentionableCollaborators (documentId: string): Promise<Array<{ id: string; email: string; full_name: string; avatar_url?: string }>> {
	const { data: docData, error: docError } = await supabase
		.from('documents')
		.select('owner_id, profiles:owner_id (id, email, full_name, avatar_url)')
		.eq('id', documentId)
		.single()

	if (docError) throw docError

	const { data: memberData, error: memberError } = await supabase
		.from('document_members')
		.select('role, profiles:user_id (id, email, full_name, avatar_url)')
		.eq('document_id', documentId)
		.in('role', ['editor'])

	if (memberError) throw memberError

	const collaboratorsMap = new Map<string, { id: string; email: string; full_name: string; avatar_url?: string }>()

	const ownerProfile = docData?.profiles as unknown as { id: string; email: string; full_name?: string; avatar_url?: string }
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

export interface UserAICredits {
	plan: 'free' | 'go' | 'pro' | 'team' | 'enterprise'
	totalAllocated: number
	usedCredits: number
	remainingCredits: number
}

export function getPlanMaxDocuments(plan: string): number {
	switch (plan.toLowerCase()) {
		case 'free': return 5
		case 'go':
		case 'pro':
		case 'team':
		case 'enterprise':
		default: return Infinity
	}
}

export function checkCanAddCollaborator(currentCount: number, plan: string, seats?: number | null): { canAdd: boolean; limit: number } {
	// T11 leak guard (Review Focus 5): legacy tokens (`go`, `enterprise`, ...)
	// are normalized before they can reach the single limit map. Without this a
	// `go` owner would silently get FREE_LIMITS instead of Plus.
	const limit = getPlanLimits(normalizeLegacyPlan(plan), seats).maxDistinctCollaborators
	return { canAdd: currentCount < limit, limit }
}

export async function getUserAICredits(userId: string): Promise<UserAICredits> {
	try {
		const { data, error } = await supabase
			.from('profiles')
			.select('plan, used_credits')
			.eq('id', userId)
			.single()

		if (error || !data) {
			return { plan: 'free', totalAllocated: 50, usedCredits: 0, remainingCredits: 50 }
		}

		const plan = (data?.plan || 'free') as UserAICredits['plan']
		const usedCredits = typeof data?.used_credits === 'number' ? data.used_credits : 0
		const totalAllocated = plan === 'go' ? 500 : plan === 'pro' ? 2500 : plan === 'team' ? 3500 : 50
		const remainingCredits = Math.max(0, totalAllocated - usedCredits)

		return { plan, totalAllocated, usedCredits, remainingCredits }
	} catch {
		return { plan: 'free', totalAllocated: 50, usedCredits: 0, remainingCredits: 50 }
	}
}

export async function deductUserAICredits(userId: string, amount: number): Promise<UserAICredits> {
	const current = await getUserAICredits(userId)
	const newUsed = current.usedCredits + amount
	try {
		await supabase
			.from('profiles')
			.update({ used_credits: newUsed })
			.eq('id', userId)
	} catch {
		// ignore update error
	}

	return {
		...current,
		usedCredits: newUsed,
		remainingCredits: Math.max(0, current.totalAllocated - newUsed),
	}
}


