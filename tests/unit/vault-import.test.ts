import { describe, it, expect, vi, afterEach } from 'vitest'
import {
	splitIntoBatches,
	BATCH_BYTE_BUDGET,
	importVaultIR,
	generateImportId,
	vaultFingerprint,
} from '@/services/vault-import'

function makePage (title: string, base64Length: number) {
	return {
		title,
		folderPath: null,
		properties: {},
		tags: [],
		contentYjsBase64: 'A'.repeat(base64Length),
		plainText: '',
		isFolder: false,
	}
}

function makeIR (pages: ReturnType<typeof makePage>[]) {
	return { workspaceId: 'ws-1', pages }
}

describe('splitIntoBatches', () => {
	it('keeps a small vault in one batch', () => {
		const { batches, oversized } = splitIntoBatches(makeIR([makePage('a', 100), makePage('b', 100)]))
		expect(batches).toHaveLength(1)
		expect(oversized).toHaveLength(0)
	})

	it('splits when the exact serialized size crosses the budget', () => {
		// Budget small enough to force a split with modest fixtures.
		const budget = 600
		const pages = [makePage('a', 300), makePage('b', 300), makePage('c', 300)]
		const { batches, oversized } = splitIntoBatches(makeIR(pages), budget)

		expect(oversized).toHaveLength(0)
		expect(batches.length).toBeGreaterThanOrEqual(2)

		// Every batch must serialize under budget — the exact invariant the
		// server enforces.
		for (const batch of batches) {
			const bytes = new TextEncoder().encode(JSON.stringify(batch)).length
			expect(bytes).toBeLessThanOrEqual(budget)
		}
		// Coverage: all pages present across batches.
		expect(batches.flatMap(b => b.pages.map(p => p.title))).toEqual(['a', 'b', 'c'])
	})

	it('rejects a single page that cannot fit any batch as oversized', () => {
		const { batches, oversized } = splitIntoBatches(makeIR([
			makePage('small', 50),
			makePage('huge', BATCH_BYTE_BUDGET),
		]))
		expect(batches).toHaveLength(1)
		expect(batches[0].pages.map(p => p.title)).toEqual(['small'])
		expect(oversized.map(p => p.title)).toEqual(['huge'])
	})

	it('orders pages deterministically so batchIndex maps to stable content', () => {
		// Directory enumeration order is implementation-defined; the fingerprint
		// is order-independent. Sorting keeps the positional batchIndex stable
		// across a retry so the server replays the right pages (#87).
		const { batches } = splitIntoBatches(makeIR([
			makePage('c', 100),
			makePage('a', 100),
			makePage('b', 100),
		]))
		expect(batches.flatMap(b => b.pages.map(p => p.title))).toEqual(['a', 'b', 'c'])
	})
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('generateImportId', () => {
	it('emits a UUID the server will accept', () => {
		expect(generateImportId()).toMatch(UUID_RE)
		expect(generateImportId()).not.toBe(generateImportId())
	})
})

describe('vaultFingerprint', () => {
	it('is stable across page order', () => {
		const a = makeIR([makePage('a', 10), makePage('b', 20)])
		const b = makeIR([makePage('b', 20), makePage('a', 10)])
		expect(vaultFingerprint(a)).toBe(vaultFingerprint(b))
	})

	it('diverges for different content or workspace', () => {
		const base = makeIR([makePage('a', 10)])
		expect(vaultFingerprint(base)).not.toBe(vaultFingerprint(makeIR([makePage('a', 11)])))
		expect(vaultFingerprint(base)).not.toBe(vaultFingerprint({ ...base, workspaceId: 'ws-2' }))
	})
})

describe('importVaultIR idempotency (#87)', () => {
	const originalFetch = global.fetch
	afterEach(() => { global.fetch = originalFetch })

	const jsonResponse = (payload: object) => new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})

	it('sends a stable clientImportId and batchIndex with the batch', async () => {
		global.fetch = vi.fn(async () => jsonResponse({
			success: true,
			importedCount: 1,
			pages: [{ id: 'p-1', title: 'a' }],
			warnings: [],
		})) as unknown as typeof global.fetch

		const outcome = await importVaultIR(makeIR([makePage('a', 100)]), async () => 'tok', undefined, {
			clientImportId: 'fixed-import-id',
		})

		const init = (global.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1]
		const body = JSON.parse(String(init.body))
		expect(body.clientImportId).toBe('fixed-import-id')
		expect(body.batchIndex).toBe(0)
		expect(outcome.resumedCount).toBe(0)
	})

	it('aggregates resumed pages from a replayed batch', async () => {
		global.fetch = vi.fn(async () => jsonResponse({
			success: true,
			resumed: true,
			importedCount: 2,
			pages: [{ id: 'p-1', title: 'a' }, { id: 'p-2', title: 'b' }],
			warnings: [],
		})) as unknown as typeof global.fetch

		const outcome = await importVaultIR(makeIR([makePage('a', 100), makePage('b', 100)]), async () => 'tok')

		expect(outcome.resumedCount).toBe(2)
		expect(outcome.createdPages).toHaveLength(2)
	})

	it('generates a fresh uuid when the caller has no session id', async () => {
		global.fetch = vi.fn(async () => jsonResponse({
			success: true,
			importedCount: 1,
			pages: [{ id: 'p-1', title: 'a' }],
			warnings: [],
		})) as unknown as typeof global.fetch

		await importVaultIR(makeIR([makePage('a', 100)]), async () => 'tok')

		const init = (global.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1]
		const body = JSON.parse(String(init.body))
		expect(body.clientImportId).toMatch(UUID_RE)
	})

	it('retries a 409 batch_in_progress instead of failing the import', async () => {
		let call = 0
		global.fetch = vi.fn(async () => {
			call += 1
			if (call === 1) {
				return new Response(JSON.stringify({ error: 'busy', code: 'batch_in_progress' }), {
					status: 409,
					headers: { 'Content-Type': 'application/json' },
				})
			}
			return jsonResponse({ success: true, importedCount: 1, pages: [{ id: 'p-1', title: 'a' }], warnings: [] })
		}) as unknown as typeof global.fetch

		const outcome = await importVaultIR(makeIR([makePage('a', 100)]), async () => 'tok')

		expect(global.fetch).toHaveBeenCalledTimes(2)
		expect(outcome.createdPages).toHaveLength(1)
	})
})
