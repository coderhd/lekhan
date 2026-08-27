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

async function getDocumentOwnerPlan(supabaseAdmin, entityId) {
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

		if (!ownerId) return 'free'

		const { data: profile } = await supabaseAdmin
			.from('profiles')
			.select('plan')
			.eq('id', ownerId)
			.single()

		return (profile && profile.plan) ? profile.plan.toLowerCase() : 'free'
	} catch {
		return 'free'
	}
}

module.exports = { getSupabaseClient, getEntityOwner, verifyUserRole, getDocumentOwnerPlan }
