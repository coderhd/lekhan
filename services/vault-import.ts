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

/**
 * Bounded retry for a `409 batch_in_progress`: a live/concurrent request already
 * owns this batch, so the client backs off and retries rather than failing the
 * whole multi-batch import (spec D2).
 */
const MAX_BATCH_ATTEMPTS = 4
const RETRY_BASE_MS = 400

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
	/** Pages reported by a replayed (already-landed) batch — honest resume count. */
	resumedCount: number
}

export interface VaultImportOptions {
	/**
	 * Stable id for this import attempt-session (#87). Reuse it across a retry to
	 * resume: the server replays already-landed batches instead of re-creating
	 * their pages. Omit to generate a fresh one.
	 */
	clientImportId?: string
}

/**
 * Generate a v4 uuid for an import attempt-session. Uses `crypto.randomUUID`
 * where available and falls back to `getRandomValues`/`Math.random` for older
 * environments, always emitting a UUID the server will accept.
 */
export function generateImportId (): string {
	const cryptoObj = (globalThis as { crypto?: Crypto }).crypto
	if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
		return cryptoObj.randomUUID()
	}
	const bytes = new Uint8Array(16)
	if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
		cryptoObj.getRandomValues(bytes)
	} else {
		for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** FNV-1a — cheap, stable, non-cryptographic. Used only for session equality. */
function hashString (input: string): string {
	let hash = 0x811c9dc5
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193)
	}
	return (hash >>> 0).toString(16)
}

/**
 * A stable identity for a vault import, independent of object identity and
 * page order. The Import dialog keys its attempt-session on this: re-picking
 * the same vault after a failure resumes the same `clientImportId`; a
 * different vault gets a fresh one (no cross-vault false "resumed").
 */
export function vaultFingerprint (ir: ObsidianImportIR): string {
	let contentBytes = 0
	const paths: string[] = []
	for (const page of ir.pages) {
		contentBytes += page.contentYjsBase64.length + page.plainText.length
		paths.push(`${page.folderPath ?? ''}/${page.title}`)
	}
	paths.sort()
	return `${ir.workspaceId}:${ir.pages.length}:${contentBytes}:${hashString(paths.join('\u0000'))}`
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

	// Sort deterministically before batching. `batchIndex` is a positional
	// idempotency key, so the page set behind each index must be stable across
	// retries. Directory enumeration order is implementation-defined (and the
	// vault fingerprint is deliberately order-independent), so without this a
	// retry could send different pages under the same batchIndex — the server
	// would replay the recorded batch and silently drop the new pages (#87).
	const orderedPages = [...ir.pages].sort((a, b) => {
		const keyA = `${a.folderPath ?? ''}\u0000${a.title}`
		const keyB = `${b.folderPath ?? ''}\u0000${b.title}`
		if (keyA === keyB) return 0
		return keyA < keyB ? -1 : 1
	})

	for (const page of orderedPages) {
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
	onProgress?: (progress: VaultImportProgress) => void,
	options?: VaultImportOptions
): Promise<VaultImportOutcome> {
	const { batches, oversized } = splitIntoBatches(ir)
	const clientImportId = options?.clientImportId ?? generateImportId()
	const createdPages: VaultImportOutcome['createdPages'] = []
	const warnings: VaultImportWarning[] = []
	let resumedCount = 0

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
		let response: Response | undefined
		for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt++) {
			const token = await getToken()
			try {
				response = await fetch('/api/import', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					// The stable id + ordinal make this batch idempotent: a retry with
					// the same pair is answered from the server's ledger, not re-written.
					body: JSON.stringify({
						...batches[i],
						clientImportId,
						batchIndex: i,
					}),
				})
			} catch (err) {
				throw new Error(`Network error during import (batch ${i + 1}/${batches.length}): ${err instanceof Error ? err.message : String(err)}`)
			}
			if (response.status !== 409) break
			// A concurrent/live request owns this batch; back off and retry.
			if (attempt < MAX_BATCH_ATTEMPTS) {
				await new Promise(resolve => setTimeout(resolve, RETRY_BASE_MS * attempt))
			}
		}
		if (!response) {
			throw new Error(`Import failed (batch ${i + 1}/${batches.length}): no response`)
		}

		let data: { importedCount?: number; pages?: VaultImportOutcome['createdPages']; warnings?: VaultImportWarning[]; resumed?: boolean; error?: string } = {}
		try {
			data = await response.json()
		} catch {
			// fall through to status check
		}

		if (!response.ok) {
			throw new Error(data.error || `Import failed (batch ${i + 1}/${batches.length}, status ${response.status})`)
		}

		const batchPages = data.pages ?? []
		for (const page of batchPages) {
			createdPages.push(page)
		}
		if (data.resumed === true) {
			resumedCount += batchPages.length
		}
		for (const warning of data.warnings ?? []) {
			warnings.push(warning)
		}
	}

	return { createdPages, warnings, batches: batches.length, resumedCount }
}
