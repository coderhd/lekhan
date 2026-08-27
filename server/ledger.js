/**
 * Durable Collaborator Ledger Service (Issue #77)
 * Tracks distinct users per document in Postgres to enforce tier limits across server restarts.
 */

async function getDistinctCollaboratorsCount (supabaseAdmin, documentId) {
	try {
		const { data, error } = await supabaseAdmin
			.from('document_collaborators_ledger')
			.select('user_id')
			.eq('document_id', documentId)

		if (error) {
			console.error(`[Ledger] Error fetching distinct collaborators for ${documentId}:`, error)
			return 0
		}

		return (data && Array.isArray(data)) ? data.length : 0
	} catch (err) {
		console.error(`[Ledger] Unexpected error in getDistinctCollaboratorsCount for ${documentId}:`, err)
		return 0
	}
}

async function isCollaboratorRegistered (supabaseAdmin, documentId, userId) {
	try {
		const { data, error } = await supabaseAdmin
			.from('document_collaborators_ledger')
			.select('user_id')
			.eq('document_id', documentId)
			.eq('user_id', userId)
			.maybeSingle()

		if (error) {
			console.error(`[Ledger] Error checking registration for ${documentId} / ${userId}:`, error)
			return false
		}

		return !!data
	} catch (err) {
		console.error(`[Ledger] Unexpected error in isCollaboratorRegistered for ${documentId}:`, err)
		return false
	}
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
			return { success: false, error }
		}

		return { success: true }
	} catch (err) {
		console.error(`[Ledger] Unexpected error in recordCollaboratorAccess for ${documentId}:`, err)
		return { success: false, error: err }
	}
}

async function getDistinctCollaboratorIds (supabaseAdmin, documentId) {
	try {
		const { data, error } = await supabaseAdmin
			.from('document_collaborators_ledger')
			.select('user_id')
			.eq('document_id', documentId)

		if (error || !data) {
			return []
		}

		return data.map(row => row.user_id)
	} catch (err) {
		return []
	}
}

module.exports = {
	getDistinctCollaboratorsCount,
	isCollaboratorRegistered,
	recordCollaboratorAccess,
	getDistinctCollaboratorIds,
}
