const { createClient } = require('@supabase/supabase-js')

function getSupabaseClient (token) {
	return createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
			global: {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			},
		}
	)
}

async function verifyUserRole (supabase, documentId) {
	const { data: { user } } = await supabase.auth.getUser()
	if (!user) {
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

module.exports = { getSupabaseClient, verifyUserRole }
