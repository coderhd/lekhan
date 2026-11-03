import { describe, it, expect, vi, afterEach } from 'vitest'
import * as Y from 'yjs'
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
	constructor(public url: string, public room: string, public doc: Y.Doc, public opts: unknown) {
		providers.push(this)
	}
	once(event: string, cb: Listener) {
		;(this.listeners[event] ||= []).push(cb)
	}
	emit(event: string) {
		for (const cb of this.listeners[event] || []) cb()
	}
	destroy() {
		this.destroyed = true
	}
}

/** Add one paragraph to the provider's Yjs doc so `hasContent` is true. */
function addBody(doc: Y.Doc, text: string) {
	const fragment = doc.getXmlFragment('default')
	const paragraph = new Y.XmlElement('paragraph')
	const content = new Y.XmlText()
	content.insert(0, text)
	paragraph.insert(0, [content])
	fragment.insert(0, [paragraph])
}

class FakePersistence {
	listeners: Record<string, Listener[]> = {}
	destroyed = false
	constructor(public name: string, public doc: Y.Doc) {
		persistences.push(this)
	}
	once(event: string, cb: Listener) {
		;(this.listeners[event] ||= []).push(cb)
	}
	emit(event: string) {
		for (const cb of this.listeners[event] || []) cb()
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
	it('resolves unavailable without opening a provider when already aborted', async () => {
		const controller = new AbortController()
		controller.abort()
		const source = createClientPageDocSource({ token: 't', wsUrl: 'ws://x', timeoutMs: 1000 })
		await expect(source('p1', controller.signal)).resolves.toEqual({ doc: null, status: 'unavailable' })
		expect(providers).toHaveLength(0)
		expect(persistences).toHaveLength(0)
	})

	it('aborts an in-flight remote read and destroys the provider', async () => {
		const controller = new AbortController()
		const source = createClientPageDocSource({ token: 't', wsUrl: 'ws://x', timeoutMs: 5000 })
		const pending = source('p1', controller.signal)
		await vi.waitFor(() => expect(providers).toHaveLength(1))
		controller.abort()
		await expect(pending).resolves.toEqual({ doc: null, status: 'unavailable' })
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
			await expect(pending).resolves.toEqual({ doc: null, status: 'unavailable' })
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
			await expect(pending).resolves.toEqual({ doc: null, status: 'unavailable' })
			expect(persistences[0].destroyed).toBe(true)
		} finally {
			;(globalThis as { indexedDB?: IDBFactory }).indexedDB = original
		}
	})
})

describe('createClientPageDocSource remote read (SIL-214)', () => {
	it('opens the collab room read-only and classifies a non-empty sync as ok', async () => {
		const source = createClientPageDocSource({ token: 't', wsUrl: 'ws://x', timeoutMs: 5000 })
		const pending = source('p1')
		await vi.waitFor(() => expect(providers).toHaveLength(1))

		// The export must never connect with a writable room.
		expect((providers[0].opts as { params: Record<string, string> }).params).toMatchObject({
			token: 't',
			documentId: 'p1',
			readOnly: '1',
		})

		addBody(providers[0].doc, 'Hello from the cold room')
		providers[0].emit('sync')
		const result = await pending

		expect(result.status).toBe('ok')
		expect(result.doc?.content?.[0]?.content?.[0]?.text).toBe('Hello from the cold room')
		expect(providers[0].destroyed).toBe(true)
	})

	it('reports a completed empty sync as empty, not success', async () => {
		const source = createClientPageDocSource({ token: 't', wsUrl: 'ws://x', timeoutMs: 5000 })
		const pending = source('p1')
		await vi.waitFor(() => expect(providers).toHaveLength(1))

		providers[0].emit('sync')
		await expect(pending).resolves.toEqual({ doc: null, status: 'empty' })
		expect(providers[0].destroyed).toBe(true)
	})

	it('reports a remote timeout as unavailable', async () => {
		const source = createClientPageDocSource({ token: 't', wsUrl: 'ws://x', timeoutMs: 10 })
		await expect(source('p1')).resolves.toEqual({ doc: null, status: 'unavailable' })
		expect(providers).toHaveLength(1)
		expect(providers[0].destroyed).toBe(true)
	})
})
