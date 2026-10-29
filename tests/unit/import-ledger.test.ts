import { describe, it, expect, beforeEach } from 'vitest'
import {
	claimImportBatch,
	completeImportBatch,
	deriveBatchPageId,
	failImportBatch,
	STALE_PROCESSING_MS,
} from '@/lib/import-ledger'

// ---------------------------------------------------------------------------
// Minimal in-memory PostgREST-shaped double for public.import_batches. It
// models exactly the chains lib/import-ledger uses, including the unique key
// and conditional (filtered) updates that make the claim race-safe.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
type Filter = [op: 'eq' | 'lt', column: string, value: unknown]

function matches (row: Row, filters: Filter[]): boolean {
	return filters.every(([op, column, value]) => {
		if (op === 'eq') return row[column] === value
		// ISO-8601 strings compare correctly lexicographically.
		return (row[column] as string) < (value as string)
	})
}

class Query {
	private filters: Filter[] = []
	private pendingInsert: Row | null = null
	private patch: Row | null = null
	private selecting = false

	constructor (private rows: Row[]) {}

	insert (row: Row) { this.pendingInsert = row; return this }
	update (patch: Row) { this.patch = patch; return this }
	select () { this.selecting = true; return this }
	eq (column: string, value: unknown) { this.filters.push(['eq', column, value]); return this }
	lt (column: string, value: unknown) { this.filters.push(['lt', column, value]); return this }

	maybeSingle () { return this.execute(true) }
	then (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
		return this.execute(false).then(resolve, reject)
	}
	catch (reject: (e: unknown) => unknown) { return this.execute(false).catch(reject) }

	private async execute (asSingle: boolean) {
		if (this.pendingInsert) {
			const row = this.pendingInsert
			const duplicate = this.rows.some(existing =>
				existing.workspace_id === row.workspace_id &&
				existing.client_import_id === row.client_import_id &&
				existing.batch_index === row.batch_index
			)
			if (duplicate) return { data: null, error: { code: '23505', message: 'duplicate key value' } }
			const now = new Date().toISOString()
			const stored: Row = {
				id: `ledger-${this.rows.length + 1}`,
				imported_count: 0,
				pages: [],
				warnings: [],
				created_at: now,
				updated_at: now,
				...row,
			}
			this.rows.push(stored)
			return { data: asSingle ? { id: stored.id } : [stored], error: null }
		}

		if (this.patch) {
			const matched = this.rows.filter(row => matches(row, this.filters))
			for (const row of matched) Object.assign(row, this.patch)
			if (!this.selecting) return { data: null, error: null }
			return { data: asSingle ? (matched[0] ? { id: matched[0].id } : null) : matched, error: null }
		}

		const matched = this.rows.filter(row => matches(row, this.filters))
		return { data: asSingle ? (matched[0] ?? null) : matched, error: null }
	}
}

function makeAdmin (rows: Row[]) {
	return { from: () => new Query(rows) }
}

const WS = 'ws-1'
const IMPORT_ID = '11111111-1111-4111-8111-111111111111'
const BASE = { workspace_id: WS, owner_id: 'owner-1', client_import_id: IMPORT_ID, batch_index: 0 }

const claim = (admin: ReturnType<typeof makeAdmin>) =>
	claimImportBatch(admin as never, { workspaceId: WS, ownerId: 'owner-1', clientImportId: IMPORT_ID, batchIndex: 0 })

describe('import ledger', () => {
	let rows: Row[]
	let admin: ReturnType<typeof makeAdmin>

	beforeEach(() => {
		rows = []
		admin = makeAdmin(rows)
	})

	it('claims a fresh batch by inserting a processing row', async () => {
		const outcome = await claim(admin)
		expect(outcome).toEqual({ kind: 'claimed', ledgerId: 'ledger-1' })
		expect(rows).toHaveLength(1)
		expect(rows[0].status).toBe('processing')
	})

	it('replays a completed batch from its recorded report', async () => {
		rows.push({
			...BASE,
			id: 'ledger-9',
			status: 'completed',
			imported_count: 2,
			pages: [{ id: 'p-1', title: 'A' }, { id: 'p-2', title: 'B' }],
			warnings: [{ title: 'B', stage: 'index', error: 'nope' }],
		})
		const outcome = await claim(admin)
		expect(outcome).toEqual({
			kind: 'completed',
			result: {
				importedCount: 2,
				pages: [{ id: 'p-1', title: 'A' }, { id: 'p-2', title: 'B' }],
				warnings: [{ title: 'B', stage: 'index', error: 'nope' }],
			},
		})
	})

	it('reclaims a failed batch atomically', async () => {
		rows.push({ ...BASE, id: 'ledger-3', status: 'failed' })
		const outcome = await claim(admin)
		expect(outcome).toEqual({ kind: 'claimed', ledgerId: 'ledger-3' })
		expect(rows[0].status).toBe('processing')
	})

	it('refuses a batch that is freshly in progress', async () => {
		rows.push({ ...BASE, id: 'ledger-4', status: 'processing', updated_at: new Date().toISOString() })
		expect(await claim(admin)).toEqual({ kind: 'in-progress' })
		expect(rows[0].status).toBe('processing')
	})

	it('reclaims a processing batch abandoned past the staleness window', async () => {
		rows.push({
			...BASE,
			id: 'ledger-5',
			status: 'processing',
			updated_at: new Date(Date.now() - STALE_PROCESSING_MS - 60_000).toISOString(),
		})
		expect(await claim(admin)).toEqual({ kind: 'claimed', ledgerId: 'ledger-5' })
	})

	it('completes a batch with its recorded report', async () => {
		rows.push({ ...BASE, id: 'ledger-6', status: 'processing' })
		const ok = await completeImportBatch(admin as never, 'ledger-6', {
			importedCount: 1,
			pages: [{ id: 'p-9', title: 'Only' }],
			warnings: [],
		})
		expect(ok).toBe(true)
		expect(rows[0].status).toBe('completed')
		expect(rows[0].imported_count).toBe(1)
		expect(rows[0].pages).toEqual([{ id: 'p-9', title: 'Only' }])
	})

	it('marks a claimed batch failed', async () => {
		rows.push({ ...BASE, id: 'ledger-7', status: 'processing' })
		await failImportBatch(admin as never, 'ledger-7')
		expect(rows[0].status).toBe('failed')
	})

	it('does not downgrade a completed batch when failing a losing writer', async () => {
		rows.push({ ...BASE, id: 'ledger-7b', status: 'completed', imported_count: 2 })
		await failImportBatch(admin as never, 'ledger-7b')
		expect(rows[0].status).toBe('completed')
		expect(rows[0].imported_count).toBe(2)
	})

	it('does not complete a batch that is no longer processing', async () => {
		rows.push({ ...BASE, id: 'ledger-8', status: 'completed', imported_count: 3 })
		const ok = await completeImportBatch(admin as never, 'ledger-8', {
			importedCount: 5,
			pages: [],
			warnings: [],
		})
		expect(ok).toBe(false)
		expect(rows[0].imported_count).toBe(3)
	})
})

describe('deriveBatchPageId', () => {
	const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

	it('is deterministic for the same batch identity', () => {
		expect(deriveBatchPageId('ws-1', 'imp-1', 2, 7))
			.toBe(deriveBatchPageId('ws-1', 'imp-1', 2, 7))
	})

	it('emits a valid RFC 4122 version 5 uuid', () => {
		const id = deriveBatchPageId('ws-1', 'imp-1', 0, 0)
		expect(id).toMatch(UUID_RE)
		expect(id[14]).toBe('5')
	})

	it('distinguishes workspace, import id, batch index and ordinal', () => {
		const base = deriveBatchPageId('ws-1', 'imp-1', 0, 0)
		expect(deriveBatchPageId('ws-2', 'imp-1', 0, 0)).not.toBe(base)
		expect(deriveBatchPageId('ws-1', 'imp-2', 0, 0)).not.toBe(base)
		expect(deriveBatchPageId('ws-1', 'imp-1', 1, 0)).not.toBe(base)
		expect(deriveBatchPageId('ws-1', 'imp-1', 0, 1)).not.toBe(base)
	})
})
