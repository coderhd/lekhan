const { createClient } = require('@supabase/supabase-js')

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

// Resolve an entity (page first, legacy document fallback) to owner + public flag.
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
			return 'viewer'
		}
		return null
	}

	const { data: { user }, error } = await supabase.auth.getUser(token)
	if (error || !user) {
		console.error(`[Auth] getUser failed for ${entityId}:`, error?.message || 'No user found')
		return null
	}

	const entity = await getEntityOwner(supabase, entityId)
	if (!entity) {
		return null
	}

	if (entity.owner_id === user.id) {
		return 'owner'
	}

	if (entity.type === 'page') {
		const { data: member } = await supabase
			.from('page_members')
			.select('role')
			.eq('page_id', entityId)
			.eq('user_id', user.id)
			.single()
		if (member) {
			return member.role
		}

		// Page-only authority (P2): page_members is the sole membership source
		// for pages — the legacy document_members fallback was removed so the
		// sync server's role verdict always matches page RLS (can_access_page).
		// Authenticated non-members get read-only access to public pages,
		// matching RLS (previously they were denied while anon could read).
		if (entity.is_public) {
			return 'viewer'
		}

		return null
	}

	const { data: member } = await supabase
		.from('document_members')
		.select('role')
		.eq('document_id', entityId)
		.eq('user_id', user.id)
		.single()

	return member ? member.role : null
}

async function getDocumentOwnerPlanLimit(supabaseAdmin, entityId) {
	try {
		const { data: page } = await supabaseAdmin
			.from('pages')
			.select('owner_id')
			.eq('id', entityId)
			.maybeSingle()

		let ownerId = null
		if (page && page.owner_id) {
			ownerId = page.owner_id
		} else {
			const { data: doc } = await supabaseAdmin
				.from('documents')
				.select('owner_id')
				.eq('id', entityId)
				.maybeSingle()
			ownerId = doc ? doc.owner_id : null
		}

		if (!ownerId) return 2

		const { data: profile } = await supabaseAdmin
			.from('profiles')
			.select('plan')
			.eq('id', ownerId)
			.single()

		const plan = (profile && profile.plan ? profile.plan : 'free').toLowerCase()
		switch (plan) {
			case 'go': return 10
			case 'pro': return 25
			case 'team': return 50
			case 'enterprise': return 9999
			case 'free':
			default: return 2
		}
	} catch {
		return 2
	}
}

module.exports = { getSupabaseClient, getEntityOwner, verifyUserRole, getDocumentOwnerPlanLimit }