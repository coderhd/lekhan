import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClientPageDocSource, hasLocalDatabase } from '@/lib/markdown/vault-export-source'

// ---------------------------------------------------------------------------
// SIL-9 S4a — vault-export browser source (ADR 0006). Covers the two PR #133
// external-review findings: cancellation must stop in-flight reads, and the
// local-cache check must not persist an empty database when the browser cannot
// enumerate databases (Firefox 111–125).
// ---------------------------------------------------------------------------

type Listener = () => void

let providers: FakeProvider[] = []
let persistences: FakePersistence[] = []

class FakeProvider {
	listeners: Record<string, Listener[]> = {}
	destroyed = false
	constructor(public url: string, public room: string, public doc: unknown, public opts: unknown) {
		providers.push(this)
	}
	once(event: string, cb: Listener) {
		;(this.listeners[event] ||= []).push(cb)
	}
	destroy() {
		this.destroyed = true
	}
}

class FakePersistence {
	listeners: Record<string, Listener[]> = {}
	destroyed = false
	constructor(public name: string, public doc: unknown) {
		persistences.push(this)
	}
	once(event: string, cb: Listener) {
		;(this.listeners[event] ||= []).push(cb)
	}
	destroy() {
		this.destroyed = true
	}
}

vi.mock('y-websocket', () => ({ WebsocketProvider: FakeProvider }))
vi.mock('y-indexeddb', () => ({ IndexeddbPersistence: FakePersistence }))

afterEach(() => {
	providers = []
	persistences = []
})

/** Minimal stand-in for the parts of `IDBFactory` the source touches. */
function fakeFactory(opts: { names: string[]; enumerable: boolean }) {
	const deleted: string[] = []
	const open = vi.fn((name: string) => {
		const exists = opts.names.includes(name)
		const request: {
			onupgradeneeded?: (e: { oldVersion: number }) => void
			onsuccess?: () => void
			onerror?: (e: unknown) => void
			onblocked?: () => void
			result?: { close: () => void }
			error?: unknown
			transaction?: { abort: () => void; aborted: boolean }
		} = {}
		// Model the versionchange transaction: aborting a create (oldVersion 0)
		// rolls the database back and errors the open request, per spec §5.8 —
		// the database is NOT left behind and no deleteDatabase runs.
		const tx = {
			aborted: false,
			abort() {
				tx.aborted = true
				queueMicrotask(() => {
					request.error = { name: 'AbortError' }
					request.onerror?.(request.error)
				})
			},
		}
		request.transaction = tx
		queueMicrotask(() => {
			if (!exists) {
				request.onupgradeneeded?.({ oldVersion: 0 })
				if (tx.aborted) return
			}
			request.result = { close: vi.fn() }
			request.onsuccess?.()
		})
		return request as unknown as IDBOpenDBRequest
	})
	const factory = {
		databases:
			opts.enumerable === false
				? undefined
				: async () => opts.names.map((name) => ({ name })),
		open,
		deleteDatabase(name: string) {
			deleted.push(name)
			return {} as IDBOpenDBRequest
		},
	}
	return { factory: factory as unknown as IDBFactory, deleted, open }
}

describe('hasLocalDatabase', () => {
	it('reads the enumeration when it is available (modern browsers)', async () => {
		await expect(hasLocalDatabase('p1', fakeFactory({ names: ['p1'], enumerable: true }).factory)).resolves.toBe(true)
		await expect(hasLocalDatabase('p1', fakeFactory({ names: [], enumerable: true }).factory)).resolves.toBe(false)
	})

	it('finds an existing database without enumeration and never deletes it', async () => {
		const { factory, deleted } = fakeFactory({ names: ['p1'], enumerable: false })
		await expect(hasLocalDatabase('p1', factory)).resolves.toBe(true)
		expect(deleted).toEqual([])
	})

	it('reports absent for a missing database by aborting the create, never deleteDatabase', async () => {
		const { factory, deleted, open } = fakeFactory({ names: [], enumerable: false })
		await expect(hasLocalDatabase('p1', factory)).resolves.toBe(false)
		expect(open).toHaveBeenCalledTimes(1)
		// The create is rolled back via abort — no database is left behind and,
		// crucially, no `deleteDatabase` can race another tab's just-created cache.
		expect(deleted).toEqual([])
	})

	it('falls back to the non-destructive probe when enumeration throws', async () => {
		const deleted: string[] = []
		const open = vi.fn(() => {
			const request: Record<string, unknown> = {}
			queueMicrotask(() => {
				request.result = { close: vi.fn() }
				;(request.onsuccess as (() => void) | undefined)?.()
			})
			return request as unknown as IDBOpenDBRequest
		})
		const factory = {
			databases: async () => {
				throw new Error('enumeration blocked')
			},
			open,
			deleteDatabase(name: string) {
				deleted.push(name)
				return {} as IDBOpenDBRequest
			},
		} as unknown as IDBFactory
		await expect(hasLocalDatabase('p1', factory)).resolves.toBe(true)
		expect(deleted).toEqual([])
	})
})

describe('createClientPageDocSource cancellation', () => {
	it('resolves null without opening a provider when already aborted', async () => {
		const controller = new AbortController()
		controller.abort()
		const source = createClientPageDocSource({ token: 't', wsUrl: 'ws://x', timeoutMs: 1000 })
		await expect(source('p1', controller.signal)).resolves.toBeNull()
		expect(providers).toHaveLength(0)
		expect(persistences).toHaveLength(0)
	})

	it('aborts an in-flight remote read and destroys the provider', async () => {
		const controller = new AbortController()
		const source = createClientPageDocSource({ token: 't', wsUrl: 'ws://x', timeoutMs: 5000 })
		const pending = source('p1', controller.signal)
		await vi.waitFor(() => expect(providers).toHaveLength(1))
		controller.abort()
		await expect(pending).resolves.toBeNull()
		expect(providers[0].destroyed).toBe(true)
	})

	it('aborts an in-flight local read and destroys persistence', async () => {
		const controller = new AbortController()
		const original = (globalThis as { indexedDB?: IDBFactory }).indexedDB
		;(globalThis as { indexedDB?: IDBFactory }).indexedDB = {
			databases: async () => [{ name: 'p1' }],
		} as unknown as IDBFactory
		try {
			const source = createClientPageDocSource({ token: 't', wsUrl: 'ws://x', timeoutMs: 5000 })
			const pending = source('p1', controller.signal)
			await vi.waitFor(() => expect(persistences).toHaveLength(1))
			controller.abort()
			await expect(pending).resolves.toBeNull()
			expect(persistences[0].destroyed).toBe(true)
			expect(providers).toHaveLength(0)
		} finally {
			;(globalThis as { indexedDB?: IDBFactory }).indexedDB = original
		}
	})

	it('reads an existing local cache when enumeration is unavailable (offline path preserved)', async () => {
		const controller = new AbortController()
		const original = (globalThis as { indexedDB?: IDBFactory }).indexedDB
		// Legacy fallback: no `databases()` enumeration, but the Page is cached.
		;(globalThis as { indexedDB?: IDBFactory }).indexedDB = fakeFactory({
			names: ['p1'],
			enumerable: false,
		}).factory
		try {
			const source = createClientPageDocSource({ token: 't', wsUrl: 'ws://x', timeoutMs: 5000 })
			const pending = source('p1', controller.signal)
			await vi.waitFor(() => expect(persistences).toHaveLength(1))
			// The local read is attempted (no remote fallback), so an offline
			// export still includes the cached body rather than a title-only note.
			expect(providers).toHaveLength(0)
			controller.abort()
			await expect(pending).resolves.toBeNull()
			expect(persistences[0].destroyed).toBe(true)
		} finally {
			;(globalThis as { indexedDB?: IDBFactory }).indexedDB = original
		}
	})
})
