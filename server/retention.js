const { getExpirationCutoffDate } = require('../lib/tier-limits.ts')

/**
 * Prunes expired document versions based on tier limits.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} documentId
 * @param {string} plan
 * @param {Date} referenceNow
 */
async function pruneExpiredDocumentVersions(supabaseAdmin, documentId, plan, referenceNow) {
	const cutoff = getExpirationCutoffDate(plan, referenceNow)

	// Fetch versions older than cutoff
	const { data: versions, error: fetchError } = await supabaseAdmin
		.from('document_versions')
		.select('id')
		.eq('document_id', documentId)
		.lt('created_at', cutoff.toISOString())

	if (fetchError) {
		console.error(`[Retention] Error fetching expired versions for doc ${documentId}:`, fetchError)
		return { success: false, error: fetchError, prunedCount: 0, prunedIds: [] }
	}

	if (!versions || versions.length === 0) {
		return { success: true, prunedCount: 0, prunedIds: [] }
	}

	const prunedIds = versions.map(v => v.id)
	const storagePaths = prunedIds.map(id => `${documentId}/versions/${id}.bin`)

	// Delete from storage
	const { error: storageError } = await supabaseAdmin.storage
		.from('documents')
		.remove(storagePaths)

	if (storageError) {
		console.error(`[Retention] Error deleting storage files for doc ${documentId}:`, storageError)
		return { success: false, error: storageError, prunedCount: 0, prunedIds: [] }
	}

	// Delete from database
	const { error: dbError } = await supabaseAdmin
		.from('document_versions')
		.delete()
		.in('id', prunedIds)

	if (dbError) {
		console.error(`[Retention] Error deleting db rows for doc ${documentId}:`, dbError)
		return { success: false, error: dbError, prunedCount: 0, prunedIds: [] }
	}

	return {
		success: true,
		prunedCount: prunedIds.length,
		prunedIds
	}
}

module.exports = { pruneExpiredDocumentVersions }
