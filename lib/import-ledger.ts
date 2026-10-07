import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Idempotent bulk-import ledger (#87).
 *
 * One row per `(workspace_id, client_import_id, batch_index)` in
 * `public.import_batches`. The route claims a batch before doing any work and
 * records the result on completion; a replay of a landed batch is answered from
 * the recorded result instead of re-creating leaf pages.
 */

export interface ImportedPageRecord {
	id: string
	title: string
}

export interface ImportWarningRecord {
	title: string
	stage: string
	error: string
}

/** The recorded report of one batch — what a replay returns verbatim. */
export interface ImportBatchResult {
	importedCount: number
	pages: ImportedPageRecord[]
	warnings: ImportWarningRecord[]
}

export interface ClaimBatchParams {
	workspaceId: string
	ownerId: string
	clientImportId: string
	batchIndex: number
}

export type ClaimBatchOutcome =
	| { kind: 'claimed'; ledgerId: string }
	| { kind: 'completed'; result: ImportBatchResult }
	| { kind: 'in-progress' }

/**
 * A crashed request's `processing` row is reclaimable after this long. Keeps a
 * stalled import from being un-resumable without allowing a live request to be
 * double-run (a concurrent caller sees `processing` inside the window → 409).
 */
export const STALE_PROCESSING_MS = 10 * 60 * 1000

/** Postgres unique-violation, as surfaced by PostgREST. */
const UNIQUE_VIOLATION = '23505'

interface LedgerRow {
	id: string
	status: string
	imported_count: number | null
	pages: unknown
	warnings: unknown
}

function toResult (row: LedgerRow): ImportBatchResult {
	return {
		importedCount: row.imported_count ?? 0,
		pages: Array.isArray(row.pages) ? (row.pages as ImportedPageRecord[]) : [],
		warnings: Array.isArray(row.warnings) ? (row.warnings as ImportWarningRecord[]) : [],
	}
}

/**
 * Claim a batch, or learn that it already landed. The insert is the claim: it
 * makes concurrent duplicates a unique violation rather than a check-then-act
 * race. Callers must not write any pages until this returns `claimed`.
 */
export async function claimImportBatch (
	admin: SupabaseClient,
	params: ClaimBatchParams
): Promise<ClaimBatchOutcome> {
	const { workspaceId, ownerId, clientImportId, batchIndex } = params

	const insert = await admin
		.from('import_batches')
		.insert({
			workspace_id: workspaceId,
			owner_id: ownerId,
			client_import_id: clientImportId,
			batch_index: batchIndex,
			status: 'processing',
		})
		.select('id')
		.maybeSingle()

	if (!insert.error && insert.data) {
		return { kind: 'claimed', ledgerId: (insert.data as { id: string }).id }
	}
	if (insert.error && (insert.error as { code?: string }).code !== UNIQUE_VIOLATION) {
		throw insert.error
	}

	// Unique violation: the batch already has a ledger row. Inspect it.
	const { data: existing, error: fetchError } = await admin
		.from('import_batches')
		.select('id, status, imported_count, pages, warnings')
		.eq('workspace_id', workspaceId)
		.eq('client_import_id', clientImportId)
		.eq('batch_index', batchIndex)
		.maybeSingle()

	if (fetchError) {
		throw fetchError
	}
	if (!existing) {
		// Raced with a prune; the caller should retry rather than risk a write.
		return { kind: 'in-progress' }
	}

	const row = existing as LedgerRow
	if (row.status === 'completed') {
		return { kind: 'completed', result: toResult(row) }
	}

	// `failed` (a real retry) or a stale `processing` (a crashed request) may be
	// reclaimed. Each reclaim is a conditional update, so two retries cannot both
	// win the same row.
	const nowIso = new Date().toISOString()

	const reclaimFailed = await admin
		.from('import_batches')
		.update({ status: 'processing', updated_at: nowIso })
		.eq('id', row.id)
		.eq('status', 'failed')
		.select('id')
		.maybeSingle()
	if (reclaimFailed.data) {
		return { kind: 'claimed', ledgerId: (reclaimFailed.data as { id: string }).id }
	}

	const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString()
	const reclaimStale = await admin
		.from('import_batches')
		.update({ status: 'processing', updated_at: nowIso })
		.eq('id', row.id)
		.eq('status', 'processing')
		.lt('updated_at', staleBefore)
		.select('id')
		.maybeSingle()
	if (reclaimStale.data) {
		return { kind: 'claimed', ledgerId: (reclaimStale.data as { id: string }).id }
	}

	return { kind: 'in-progress' }
}

/**
 * Record a batch's result. Returns false on write failure so the caller can
 * decide (pages already exist; silently claiming success would forfeit
 * idempotency on retry).
 */
export async function completeImportBatch (
	admin: SupabaseClient,
	ledgerId: string,
	result: ImportBatchResult
): Promise<boolean> {
	const { error } = await admin
		.from('import_batches')
		.update({
			status: 'completed',
			imported_count: result.importedCount,
			pages: result.pages,
			warnings: result.warnings,
			updated_at: new Date().toISOString(),
		})
		.eq('id', ledgerId)
	return !error
}

/** Mark a claimed batch failed so a retry may reclaim it. Best-effort. */
export async function failImportBatch (admin: SupabaseClient, ledgerId: string): Promise<void> {
	await admin
		.from('import_batches')
		.update({ status: 'failed', updated_at: new Date().toISOString() })
		.eq('id', ledgerId)
}
