import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { MarkdownEngine, base64ToUint8Array } from '@/lib/markdown/engine'
import { createClientPageDocSource } from '@/lib/markdown/vault-export-source'

const { setupWSConnection, setPersistence, docs } = require('y-websocket/bin/utils')
const { createCollabPersistence, markWritable, openHydratedDoc } = require('../../server/collab-persistence.js')

// ---------------------------------------------------------------------------
// SIL-214 B1/B2 regression: a COLD collab server (no editor tabs / no writable
// connections) must hand the export the stored body, and must leave the stored
// snapshot byte-for-byte untouched. The previous code synced an empty room and
// then persisted that empty doc over the snapshot on close.
// ---------------------------------------------------------------------------

const silentLogger = { log: () => {}, warn: () => {}, error: () => {} }

/** Populate a Page snapshot the same way the editor does (live-schema Yjs). */
function snapshotFor(markdown: string): Uint8Array {
	const engine = new MarkdownEngine()
	try {
		const parsed = engine.parse(markdown)
		return base64ToUint8Array(engine.seedToYjsBase64(parsed))
	} finally {
		engine.destroy()
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}

describe('vault export against a cold collab room (SIL-214)', () => {
	let httpServer: http.Server
	let wss: WebSocketServer
	let wsUrl: string
	let stored: Map<string, Uint8Array>
	let persisted: string[]

	beforeAll(() => {
		// y-websocket's provider reads the global WebSocket constructor; `ws`
		// implements the browser event surface it uses.
		;(globalThis as { WebSocket?: unknown }).WebSocket = WebSocket
	})

	afterAll(() => {
		;(globalThis as { WebSocket?: unknown }).WebSocket = undefined
	})

	beforeEach(async () => {
		docs.clear()
		stored = new Map()
		persisted = []
		setPersistence(
			createCollabPersistence({
				loadState: async (documentId: string) => stored.get(documentId) ?? null,
				persistState: async (documentId: string, ydoc: Y.Doc) => {
					persisted.push(documentId)
					stored.set(documentId, Y.encodeStateAsUpdate(ydoc))
				},
				scheduleSave: () => {},
				clearSave: () => {},
				logger: silentLogger,
			}),
		)

		httpServer = http.createServer()
		wss = new WebSocketServer({ noServer: true })
		httpServer.on('upgrade', (request, socket, head) => {
			void (async () => {
				const url = new URL(request.url || '/', 'http://localhost')
				const documentId = url.searchParams.get('documentId')
				if (!documentId) {
					socket.destroy()
					return
				}
				const readOnly = url.searchParams.get('readOnly') === '1'
				// Production ordering: hydrate BEFORE y-websocket can send sync
				// step 1 (server/index.js upgrade path does the same).
				const doc = await openHydratedDoc(documentId, { timeoutMs: 5000, logger: silentLogger })
				if (!readOnly) markWritable(doc)

				wss.handleUpgrade(request, socket, head, (ws) => {
					;(ws as unknown as { isReadOnly: boolean }).isReadOnly = readOnly
					request.url = `/${documentId}`
					wss.emit('connection', ws, request)
				})
			})().catch(() => socket.destroy())
		})
		wss.on('connection', (ws, request) => setupWSConnection(ws, request))

		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		wsUrl = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
	})

	afterEach(async () => {
		docs.clear()
		await new Promise<void>((resolve) => wss.close(() => resolve()))
		await new Promise<void>((resolve) => httpServer.close(() => resolve()))
	})

	it('exports the stored body from a cold room and does not truncate the snapshot', async () => {
		const original = snapshotFor('# Alpha\n\nCold note body that must survive.\n')
		stored.set('page-1', original)
		const before = Buffer.from(original).toString('base64')

		const source = createClientPageDocSource({ token: 'test-token', wsUrl, timeoutMs: 5000 })
		const result = await withTimeout(source('page-1'), 8000, 'cold export read')

		// B1: the body is real, not an empty success.
		expect(result.status).toBe('ok')
		expect(JSON.stringify(result.doc)).toContain('Cold note body that must survive.')

		// Wait for the provider's close to reach the server and run writeState.
		await vi.waitFor(() => expect(docs.has('page-1')).toBe(false), { timeout: 5000 })

		// B2: the read-only connection never persisted, and the snapshot is
		// byte-identical to what was stored before the export.
		expect(persisted).not.toContain('page-1')
		expect(Buffer.from(stored.get('page-1')!).toString('base64')).toBe(before)
	})

	it('refuses a room it cannot hydrate instead of serving an empty body', async () => {
		setPersistence(
			createCollabPersistence({
				loadState: async () => {
					throw new Error('storage down')
				},
				persistState: async () => {
					throw new Error('must not persist')
				},
				scheduleSave: () => {},
				clearSave: () => {},
				logger: silentLogger,
			}),
		)

		const source = createClientPageDocSource({ token: 'test-token', wsUrl, timeoutMs: 150 })
		const result = await withTimeout(source('page-3'), 5000, 'failing hydration read')

		// No completed sync → unavailable (warned), never a false "empty" success.
		expect(result).toEqual({ doc: null, status: 'unavailable' })
		expect(stored.has('page-3')).toBe(false)
	})

	it('still persists a hydrated room when a writable connection edited it', async () => {
		const { WebsocketProvider } = await import('y-websocket')
		const doc = new Y.Doc()
		const provider = new WebsocketProvider(wsUrl, 'page-2', doc, {
			params: { token: 'test-token', documentId: 'page-2' },
			connect: true,
		})

		await withTimeout(new Promise<void>((resolve) => provider.once('sync', () => resolve())), 5000, 'writable sync')
		doc.getText('default').insert(0, 'edited body')
		// Let the update reach the server before closing.
		await new Promise((resolve) => setTimeout(resolve, 25))
		provider.destroy()

		await vi.waitFor(() => expect(docs.has('page-2')).toBe(false), { timeout: 5000 })
		expect(persisted).toContain('page-2')
		expect(stored.get('page-2')!.byteLength).toBeGreaterThan(2)
	})
})
