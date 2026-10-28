const { createClient } = require('@supabase/supabase-js')
const { resolveOwnerWorkspaceEntitlement } = require('../lib/billing/entitlements.ts')

function getSupabaseClient(token) {
	const apiKey =
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
		''

	return createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL,
		apiKey,
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
			global: {
				headers: {
					apikey: apiKey,
					Authorization: `Bearer ${token}`,
				},
			},
		}
	)
}

async function getEntityOwner(supabase, entityId) {
	const { data: page } = await supabase
		.from('pages')
		.select('owner_id, is_public')
		.eq('id', entityId)
		.maybeSingle()

	if (page) {
		return { type: 'page', owner_id: page.owner_id, is_public: page.is_public }
	}

	const { data: doc } = await supabase
		.from('documents')
		.select('owner_id, is_public')
		.eq('id', entityId)
		.maybeSingle()

	if (doc) {
		return { type: 'document', owner_id: doc.owner_id, is_public: doc.is_public }
	}

	return null
}

async function verifyUserRole(supabase, entityId, token) {
	if (token === 'anonymous') {
		const entity = await getEntityOwner(supabase, entityId)
		if (entity && entity.is_public) {
			return { role: 'viewer', userId: 'anonymous' }
		}
		return { role: null, userId: null }
	}

	const { data: { user }, error } = await supabase.auth.getUser(token)
	if (error || !user) {
		console.error(`[Auth] getUser failed for ${entityId}:`, error?.message || 'No user found')
		return { role: null, userId: null }
	}

	const entity = await getEntityOwner(supabase, entityId)
	if (!entity) {
		return { role: null, userId: user.id }
	}

	if (entity.owner_id === user.id) {
		return { role: 'owner', userId: user.id }
	}

	if (entity.type === 'page') {
		const { data: member } = await supabase
			.from('page_members')
			.select('role')
			.eq('page_id', entityId)
			.eq('user_id', user.id)
			.single()
		if (member) {
			return { role: member.role, userId: user.id }
		}

		if (entity.is_public) {
			return { role: 'viewer', userId: user.id }
		}

		return { role: null, userId: user.id }
	}

	const { data: member } = await supabase
		.from('document_members')
		.select('role')
		.eq('document_id', entityId)
		.eq('user_id', user.id)
		.single()

	return { role: member ? member.role : null, userId: user.id }
}

async function getEntityOwnerId(supabaseAdmin, entityId) {
	const { data: page, error: pageError } = await supabaseAdmin
		.from('pages')
		.select('owner_id')
		.eq('id', entityId)
		.maybeSingle()

	if (pageError && pageError.code !== 'PGRST116') {
		throw pageError
	}

	if (page && page.owner_id) {
		return page.owner_id
	}

	const { data: doc, error: docError } = await supabaseAdmin
		.from('documents')
		.select('owner_id')
		.eq('id', entityId)
		.maybeSingle()

	if (docError && docError.code !== 'PGRST116') {
		throw docError
	}

	return doc ? doc.owner_id : null
}

/**
 * T11 — entitlement source for the entity's OWNER.
 *
 * Owner → workspace → `workspace_plans` row. The deprecated `profiles.plan`
 * mirror is deliberately NOT read here; the billing root is the workspace.
 * Returns `null` when the owner (or its workspace row) does not exist yet.
 */
async function getDocumentOwnerEntitlement(supabaseAdmin, entityId) {
	const ownerId = await getEntityOwnerId(supabaseAdmin, entityId)
	if (!ownerId) return null
	return resolveOwnerWorkspaceEntitlement(ownerId, supabaseAdmin)
}

async function getDocumentOwnerPlan(supabaseAdmin, entityId) {
	const entitlement = await getDocumentOwnerEntitlement(supabaseAdmin, entityId)
	return entitlement ? entitlement.tier : 'free'
}

module.exports = {
	getSupabaseClient,
	getEntityOwner,
	verifyUserRole,
	getEntityOwnerId,
	getDocumentOwnerEntitlement,
	getDocumentOwnerPlan,
}
