import type { ObsidianImportIR } from '@/services/obsidian-import'

/**
 * Client-side writer for `/api/import`: batches the IR into payload groups
 * under the server's 64 MB ceiling (see app/api/import/route.ts) and POSTs
 * them sequentially, aggregating created pages and warnings across batches.
 * Folder chains are deduped/reused server-side per batch, so batching is
 * safe and preserves full coverage.
 */

/** Conservative per-batch budget (server ceiling is 64 MB of decoded JSON). */
export const BATCH_BYTE_BUDGET = 48 * 1024 * 1024

const textEncoder = new TextEncoder()

function batchByteLength (workspaceId: string, pages: ObsidianImportIR['pages']): number {
	// Measure the EXACT UTF-8 serialization the server will receive — field
	// names, workspace id, and non-ASCII titles all count toward the limit,
	// so estimating from base64 length alone can undercount and trip the
	// server's payload ceiling mid-import.
	return textEncoder.encode(JSON.stringify({ workspaceId, pages })).length
}

export interface VaultImportWarning {
	title: string
	stage: string
	error: string
}

export interface VaultImportOutcome {
	createdPages: Array<{ id: string; title: string }>
	warnings: VaultImportWarning[]
	batches: number
}

export interface VaultImportProgress {
	stage: 'writing'
	batch: number
	totalBatches: number
}

/**
 * Split the IR into batches whose exact serialized size stays under
 * `budgetBytes`. Pages too large to fit in a batch alone are returned
 * separately as `oversized` so the caller can surface them as skipped
 * instead of sending a request guaranteed to be rejected.
 */
export function splitIntoBatches (
	ir: ObsidianImportIR,
	budgetBytes: number = BATCH_BYTE_BUDGET
): { batches: ObsidianImportIR[]; oversized: ObsidianImportIR['pages'] } {
	const batches: ObsidianImportIR['pages'][] = []
	const oversized: ObsidianImportIR['pages'] = []
	let current: ObsidianImportIR['pages'] = []

	for (const page of ir.pages) {
		const candidate = [...current, page]
		if (batchByteLength(ir.workspaceId, candidate) <= budgetBytes) {
			current = candidate
			continue
		}
		if (current.length > 0) {
			batches.push(current)
			current = []
		}
		// The page didn't fit even alongside others; check if it fits alone.
		if (batchByteLength(ir.workspaceId, [page]) <= budgetBytes) {
			current = [page]
		} else {
			oversized.push(page)
		}
	}
	if (current.length > 0) {
		batches.push(current)
	}

	return {
		batches: batches.map(batchPages => ({ workspaceId: ir.workspaceId, pages: batchPages })),
		oversized,
	}
}

export async function importVaultIR (
	ir: ObsidianImportIR,
	getToken: () => Promise<string>,
	onProgress?: (progress: VaultImportProgress) => void
): Promise<VaultImportOutcome> {
	const { batches, oversized } = splitIntoBatches(ir)
	const createdPages: VaultImportOutcome['createdPages'] = []
	const warnings: VaultImportWarning[] = []

	// Pages that cannot fit any single batch are skipped up-front — sending
	// them would guarantee a 413 for the whole batch.
	for (const page of oversized) {
		warnings.push({
			title: page.title,
			stage: 'payload',
			error: 'Page exceeds the per-batch payload limit and was skipped',
		})
	}

	for (let i = 0; i < batches.length; i++) {
		onProgress?.({ stage: 'writing', batch: i + 1, totalBatches: batches.length })
		const token = await getToken()
		let response: Response
		try {
			response = await fetch('/api/import', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(batches[i]),
			})
		} catch (err) {
			throw new Error(`Network error during import (batch ${i + 1}/${batches.length}): ${err instanceof Error ? err.message : String(err)}`)
		}

		let data: { importedCount?: number; pages?: VaultImportOutcome['createdPages']; warnings?: VaultImportWarning[]; error?: string } = {}
		try {
			data = await response.json()
		} catch {
			// fall through to status check
		}

		if (!response.ok) {
			throw new Error(data.error || `Import failed (batch ${i + 1}/${batches.length}, status ${response.status})`)
		}

		for (const page of data.pages ?? []) {
			createdPages.push(page)
		}
		for (const warning of data.warnings ?? []) {
			warnings.push(warning)
		}
	}

	return { createdPages, warnings, batches: batches.length }
}
