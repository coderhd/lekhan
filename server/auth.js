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

async function verifyUserRole(supabase, documentId, token) {
	if (token === 'anonymous') {
		const apiKey =
			process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
			process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
			''

		const anonClient = createClient(
			process.env.NEXT_PUBLIC_SUPABASE_URL,
			apiKey,
			{
				auth: { persistSession: false, autoRefreshToken: false },
				global: { headers: { apikey: apiKey } },
			}
		)
		const { data: doc } = await anonClient
			.from('documents')
			.select('is_public')
			.eq('id', documentId)
			.single()
		
		if (doc && doc.is_public) {
			return 'viewer'
		}
		return null
	}

	const { data: { user }, error } = await supabase.auth.getUser(token)
	if (error || !user) {
		console.error(`[Auth] getUser failed for doc ${documentId}:`, error?.message || 'No user found')
		return null
	}

	const { data: doc } = await supabase
		.from('documents')
		.select('owner_id')
		.eq('id', documentId)
		.single()

	if (doc && doc.owner_id === user.id) {
		return 'owner'
	}

	const { data: member } = await supabase
		.from('document_members')
		.select('role')
		.eq('document_id', documentId)
		.eq('user_id', user.id)
		.single()

	return member ? member.role : null
}

async function getDocumentOwnerPlanLimit(supabaseAdmin, documentId) {
	try {
		const { data: doc } = await supabaseAdmin
			.from('documents')
			.select('owner_id')
			.eq('id', documentId)
			.single()

		if (!doc || !doc.owner_id) return 2

		const { data: profile } = await supabaseAdmin
			.from('profiles')
			.select('plan')
			.eq('id', doc.owner_id)
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

module.exports = { getSupabaseClient, verifyUserRole, getDocumentOwnerPlanLimit }
