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
		const request: Record<string, unknown> = {}
		queueMicrotask(() => {
			// A missing database is created on open: oldVersion 0 upgrade.
			if (!exists) (request.onupgradeneeded as ((e: unknown) => void) | undefined)?.({ oldVersion: 0 })
			request.result = { close: vi.fn() }
			;(request.onsuccess as (() => void) | undefined)?.()
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

	it('reports absent without opening or deleting when enumeration is unavailable (non-destructive fallback)', async () => {
		const { factory, deleted, open } = fakeFactory({ names: [], enumerable: false })
		await expect(hasLocalDatabase('p1', factory)).resolves.toBe(false)
		// The fallback must not open (which would create an empty DB) or delete
		// (which could race another tab's just-created cache).
		expect(open).not.toHaveBeenCalled()
		expect(deleted).toEqual([])
	})

	it('reports absent without deleting a present database when enumeration is unavailable', async () => {
		const { factory, deleted, open } = fakeFactory({ names: ['p1'], enumerable: false })
		await expect(hasLocalDatabase('p1', factory)).resolves.toBe(false)
		expect(open).not.toHaveBeenCalled()
		expect(deleted).toEqual([])
	})

	it('reports absent without opening or deleting when the enumeration call throws', async () => {
		const deleted: string[] = []
		const open = vi.fn()
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
		await expect(hasLocalDatabase('p1', factory)).resolves.toBe(false)
		expect(open).not.toHaveBeenCalled()
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
})
