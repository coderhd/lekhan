const Y = require('yjs')
const { encryptSnapshot } = require('./crypto.js')
const graphIndex = require('./graph-index.js')
const { pruneExpiredDocumentVersions } = require('./retention.js')
const { getDocumentOwnerPlan } = require('./auth.js')

/**
 * Creates a configured PagePersister instance.
 *
 * @param {Object} config
 * @param {import('@supabase/supabase-js').SupabaseClient} config.supabaseAdmin
 * @param {boolean} [config.isE2EEnabled=false] - If true, skips server-side indexing
 * @param {Object} [config.indexer] - Optional graph indexer service
 * @param {Object} [config.retentionEngine] - Optional retention pruner service
 * @param {Object} [config.authService] - Optional plan lookup service
 * @returns {{ persist: (documentId: string, ydoc: import('yjs').Doc, options?: { isE2EEnabled?: boolean }) => Promise<{ success: boolean, documentId: string, nonCriticalResults: { indexingSuccess: boolean, retentionSuccess: boolean } }> }}
 */
function createPagePersister({
	supabaseAdmin,
	isE2EEnabled: defaultE2EEnabled = false,
	indexer = graphIndex,
	retentionEngine = { pruneExpiredDocumentVersions },
	authService = { getDocumentOwnerPlan },
}) {
	return {
		persist: async (documentId, ydoc, options = {}) => {
			let indexingSuccess = true
			let retentionSuccess = true
			const isE2EEnabled = options.isE2EEnabled !== undefined ? options.isE2EEnabled : defaultE2EEnabled

			try {
				// 1. Encode Yjs state to binary and encrypt at rest
				const stateUpdate = Y.encodeStateAsUpdate(ydoc)
				const encryptedBuffer = encryptSnapshot(stateUpdate)

				// 2. Upload encrypted binary to Supabase Storage documents bucket
				const { error: uploadError } = await supabaseAdmin.storage
					.from('documents')
					.upload(`${documentId}/main_state.bin`, encryptedBuffer, {
						contentType: 'application/octet-stream',
						upsert: true,
					})

				if (uploadError) {
					throw uploadError
				}

				// 3. Extract text content; update pages first, fall back to legacy documents
				const textContent = ydoc.getText('default').toString()
				const { data: pageRow } = await supabaseAdmin
					.from('pages')
					.select('id')
					.eq('id', documentId)
					.maybeSingle()

				if (pageRow) {
					if (!isE2EEnabled) {
						await indexer.indexPage(supabaseAdmin, documentId, textContent).catch(err => {
							console.warn('[Persister] Indexing error:', err)
							indexingSuccess = false
						})
					}
				} else {
					const { error: dbError } = await supabaseAdmin
						.from('documents')
						.update({
							searchable_text: textContent,
							updated_at: new Date().toISOString(),
						})
						.eq('id', documentId)

					if (dbError) {
						throw dbError
					}
				}

				// 4. Prune expired versions
				await (async () => {
					try {
						const ownerPlan = await authService.getDocumentOwnerPlan(supabaseAdmin, documentId)
						if (ownerPlan) {
							const pruneResult = await retentionEngine.pruneExpiredDocumentVersions(supabaseAdmin, documentId, ownerPlan, new Date())
							if (pruneResult && pruneResult.success === false) {
								retentionSuccess = false
							}
						}
					} catch (planError) {
						console.warn('[Persister] Retention error:', planError)
						retentionSuccess = false
					}
				})()

				return { success: true, documentId, nonCriticalResults: { indexingSuccess, retentionSuccess } }
			} catch (error) {
				console.error(`[Persister] Failed to save document ${documentId}:`, error)
				throw error
			}
		}
	}
}

module.exports = { createPagePersister }
