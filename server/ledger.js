/**
 * Durable Collaborator Ledger Service (Issue #77)
 * Tracks distinct users per document in Postgres to enforce tier limits across server restarts.
 */

async function admitCollaborator (supabaseAdmin, documentId, userId, maxCollaborators) {
	if (!userId || userId === 'anonymous') {
		return { allowed: true, is_registered: false }
	}

	// 1. Try atomic database RPC
	try {
		const { data, error } = await supabaseAdmin.rpc('record_collaborator_if_capacity', {
			p_document_id: documentId,
			p_user_id: userId,
			p_max_collaborators: maxCollaborators,
		})

		if (!error && data && typeof data.allowed === 'boolean') {
			return data
		}

		if (error && error.code !== '42883') { // 42883 = undefined_function (e.g. if RPC is missing)
			console.error(`[Ledger] Error in admitCollaborator RPC for ${documentId} / ${userId}:`, error)
			throw error
		}
	} catch (rpcErr) {
		if (rpcErr && rpcErr.code !== '42883') {
			throw rpcErr
		}
	}

	// 2. Fallback to check-and-upsert sequence if RPC is not present
	const isRegistered = await isCollaboratorRegistered(supabaseAdmin, documentId, userId)
	if (isRegistered) {
		await recordCollaboratorAccess(supabaseAdmin, documentId, userId)
		return { allowed: true, is_registered: true }
	}

	const currentCount = await getDistinctCollaboratorsCount(supabaseAdmin, documentId)
	if (currentCount >= maxCollaborators) {
		return { allowed: false, is_registered: false, current_count: currentCount }
	}

	await recordCollaboratorAccess(supabaseAdmin, documentId, userId)
	return { allowed: true, is_registered: false, current_count: currentCount + 1 }
}

async function getDistinctCollaboratorsCount (supabaseAdmin, documentId) {
	const { data, error } = await supabaseAdmin
		.from('document_collaborators_ledger')
		.select('user_id')
		.eq('document_id', documentId)

	if (error) {
		console.error(`[Ledger] Error fetching distinct collaborators for ${documentId}:`, error)
		throw error
	}

	return (data && Array.isArray(data)) ? data.length : 0
}

async function isCollaboratorRegistered (supabaseAdmin, documentId, userId) {
	const { data, error } = await supabaseAdmin
		.from('document_collaborators_ledger')
		.select('user_id')
		.eq('document_id', documentId)
		.eq('user_id', userId)
		.maybeSingle()

	if (error) {
		console.error(`[Ledger] Error checking registration for ${documentId} / ${userId}:`, error)
		throw error
	}

	return !!data
}

async function recordCollaboratorAccess (supabaseAdmin, documentId, userId) {
	try {
		const nowIso = new Date().toISOString()
		const { error } = await supabaseAdmin
			.from('document_collaborators_ledger')
			.upsert(
				{
					document_id: documentId,
					user_id: userId,
					last_seen_at: nowIso,
				},
				{ onConflict: 'document_id, user_id' }
			)

		if (error) {
			console.error(`[Ledger] Error upserting collaborator ${userId} for ${documentId}:`, error)
			throw error
		}

		return { success: true }
	} catch (err) {
		console.error(`[Ledger] Unexpected error in recordCollaboratorAccess for ${documentId}:`, err)
		throw err
	}
}

async function getDistinctCollaboratorIds (supabaseAdmin, documentId) {
	const { data, error } = await supabaseAdmin
		.from('document_collaborators_ledger')
		.select('user_id')
		.eq('document_id', documentId)

	if (error) {
		console.error(`[Ledger] Error in getDistinctCollaboratorIds for ${documentId}:`, error)
		throw error
	}

	return (data || []).map(row => row.user_id)
}

module.exports = {
	admitCollaborator,
	getDistinctCollaboratorsCount,
	isCollaboratorRegistered,
	recordCollaboratorAccess,
	getDistinctCollaboratorIds,
}
