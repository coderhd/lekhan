import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const indexPageMock = vi.hoisted(() => vi.fn())
const normalizeTitleMock = vi.hoisted(() => (title: string) =>
	String(title || '').toLowerCase().replace(/\s+/g, ' ').trim()
)

// Mock the CJS graph-index seam: tests assert indexPage calls, not extraction.
vi.mock('../../server/graph-index.js', () => ({
	default: { normalizeTitle: normalizeTitleMock, indexPage: indexPageMock },
}))

// ---------------------------------------------------------------------------
// Supabase admin double
// ---------------------------------------------------------------------------

interface AdminOptions {
	workspaceOwner?: string | null
	existingPages?: Array<{ id: string; title: string; parent_id: string | null }>
	folderIds?: string[]
	uploadError?: Error | null
}

/**
 * Builds a supabaseAdmin double covering the exact call shapes /api/import uses:
 * - workspaces.select().eq().maybeSingle()
 * - pages.select().eq()            → existing-pages fetch (awaited directly)
 * - pages.insert(row).select().single()          → folder-page creation
 * - pages.insert(rows).select()    → leaf batch insert (awaited directly)
 * - storage.from('documents').upload(path, ...)
 */
function makeAdminClient(options: AdminOptions = {}) {
	const calls = {
		uploadedPaths: [] as string[],
		folderInserts: [] as Record<string, unknown>[],
		batchInserts: [] as Array<Record<string, unknown>[]>,
	}
	let pageCounter = 0

	const thenableResult = (compute: () => unknown) => ({
		then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
			Promise.resolve()
				.then(compute)
				.then(resolve, reject),
		catch: (reject: (e: unknown) => unknown) =>
			Promise.resolve().then(compute).catch(reject),
	})

	const makeChain = () => {
		const chain: Record<string, unknown> & { __insertRows?: unknown } = {}
		chain.select = vi.fn(() => chain)
		chain.eq = vi.fn(() => chain)
		chain.insert = vi.fn((rows: unknown) => {
			chain.__insertRows = rows
			return chain
		})
		chain.maybeSingle = vi.fn(async () => {
			// Only the workspaces ownership lookup uses maybeSingle.
			return { data: options.workspaceOwner === undefined ? null : { owner_id: options.workspaceOwner }, error: null }
		})
		chain.single = vi.fn(async () => {
			const row = chain.__insertRows as Record<string, unknown>
			calls.folderInserts.push(row)
			return { data: { id: `folder-${calls.folderInserts.length}` }, error: null }
		})
		chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
			thenableResult(() => {
				if (chain.__insertRows === undefined) {
					return { data: options.existingPages ?? [], error: null }
				}
				const rows = Array.isArray(chain.__insertRows) ? chain.__insertRows : [chain.__insertRows]
				calls.batchInserts.push(rows as Array<Record<string, unknown>>)
				return {
					data: rows.map(() => ({ id: `page-${++pageCounter}` })),
					error: null,
				}
			}).then(resolve, reject)
		chain.catch = (reject: (e: unknown) => unknown) =>
			thenableResult(() => {
				throw new Error('unexpected')
			}).catch(reject)
		return chain
	}

	const admin = {
		from: vi.fn((table: string) => {
			if (table === 'workspaces') return makeChain()
			return makeChain()
		}),
		storage: {
			from: vi.fn(() => ({
				upload: vi.fn(async (path: string) => {
					calls.uploadedPaths.push(path)
					if (options.uploadError) return { error: options.uploadError }
					return { error: null }
				}),
			})),
		},
		auth: {
			getUser: vi.fn(async () => ({
				data: { user: { id: 'owner-1' } as null | { id: string } },
				error: null,
			})),
		},
	}
	return { admin, calls }
}

// ---------------------------------------------------------------------------
// Route harness: the route's first createClient call is the caller-scoped
// client; the second is supabaseAdmin. Tests swap the admin via h.adminClient.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
	const defaultCaller = {
		auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } as null | { id: string } }, error: null }) },
	}
	return {
		count: 0,
		adminClient: null as object | null,
		callerClient: null as object | null,
		defaultCaller,
	}
})

vi.mock('@supabase/supabase-js', () => ({
	createClient: () => {
		h.count += 1
		if (h.count === 1) return h.callerClient ?? h.defaultCaller
		return h.adminClient ?? h.defaultCaller
	},
}))

async function loadRoute() {
	const mod = await import('@/app/api/import/route')
	return mod.POST
}

const validPage = {
	title: 'Welcome',
	folderPath: null,
	properties: {},
	tags: [],
	contentYjsBase64: Buffer.from('hello').toString('base64'),
	plainText: 'hello',
	isFolder: false,
}

function makeRequest(body: object, withAuth = true) {
	return new NextRequest('http://localhost/api/import', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(withAuth ? { Authorization: 'Bearer token-1' } : {}),
		},
		body: JSON.stringify(body),
	})
}

let clients: ReturnType<typeof makeAdminClient>

describe('API Route: POST /api/import', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		indexPageMock.mockResolvedValue({ links: 0, tags: 0 })
		h.count = 0
		h.adminClient = null
		h.callerClient = null
	})

	it('returns 401 when the authorization header is missing', async () => {
		const POST = await loadRoute()
		const res = await POST(makeRequest({ workspaceId: 'ws1', pages: [validPage] }, false))
		expect(res.status).toBe(401)
	})

	it('returns 401 when the JWT does not resolve to a user', async () => {
		h.callerClient = {
			auth: { getUser: async () => ({ data: { user: null }, error: null }) },
		}
		const POST = await loadRoute()
		const res = await POST(makeRequest({ workspaceId: 'ws1', pages: [validPage] }))
		expect(res.status).toBe(401)
	})

	it('returns 400 when workspaceId or pages are missing/empty', async () => {
		await loadRoute()
		const POST = (await import('@/app/api/import/route')).POST
		for (const body of [{ pages: [validPage] }, { workspaceId: 'ws1' }, { workspaceId: 'ws1', pages: [] }]) {
			const res = await POST(makeRequest(body))
			expect(res.status).toBe(400)
		}
	})

	it('returns 400 when a page lacks title or Yjs state', async () => {
		const POST = await loadRoute()
		const res = await POST(makeRequest({
			workspaceId: 'ws1',
			pages: [{ ...validPage, contentYjsBase64: '' }],
		}))
		expect(res.status).toBe(400)
	})

	it('returns 413 when a page snapshot exceeds the size ceiling', async () => {
		const POST = await loadRoute()
		const res = await POST(makeRequest({
			workspaceId: 'ws1',
			pages: [{ ...validPage, contentYjsBase64: Buffer.alloc(21 * 1024 * 1024).toString('base64') }],
		}))
		expect(res.status).toBe(413)
	})

	it('rejects non-owner callers via trusted service-role lookup', async () => {
		clients = makeAdminClient({ workspaceOwner: 'someone-else' })
		h.adminClient = clients.admin
		const POST = await loadRoute()
		const res = await POST(makeRequest({ workspaceId: 'ws1', pages: [validPage] }))
		expect(res.status).toBe(403)
		const data = await res.json()
		expect(data.error).toMatch(/owner/i)
	})

	it('creates folder chains once, uploads snapshots, and indexes every leaf', async () => {
		clients = makeAdminClient({
			workspaceOwner: 'owner-1',
			existingPages: [{ id: 'existing-guides', title: 'Guides', parent_id: null }],
		})
		h.adminClient = clients.admin
		const POST = await loadRoute()

		const res = await POST(makeRequest({
			workspaceId: 'ws1',
			pages: [
				{ ...validPage, title: 'A', plainText: 'alpha text', folderPath: 'guides/deep' },
				{ ...validPage, title: 'B', folderPath: 'guides/deep' },
				{ ...validPage, title: 'C', folderPath: null },
			],
		}))

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.success).toBe(true)
		expect(data.importedCount).toBe(3)
		expect(data.pages).toHaveLength(3)
		expect(data.warnings).toEqual([])

		// Shared "guides" segment reused; only "deep" created once.
		expect(clients.calls.folderInserts).toHaveLength(1)
		expect(clients.calls.folderInserts[0].title).toBe('deep')

		// One batch insert carrying all three leaves.
		expect(clients.calls.batchInserts).toHaveLength(1)
		expect(clients.calls.batchInserts[0]).toHaveLength(3)

		// Three snapshot uploads at documents/{id}/main_state.bin.
		expect(clients.calls.uploadedPaths.filter(p => p.endsWith('/main_state.bin'))).toHaveLength(3)

		// Every leaf indexed with its plain text.
		expect(indexPageMock).toHaveBeenCalledTimes(3)
		const firstCall = indexPageMock.mock.calls[0]
		expect(firstCall[2]).toBe('alpha text')
	})

	it('reports per-page warnings instead of failing when snapshot upload errors', async () => {
		clients = makeAdminClient({
			workspaceOwner: 'owner-1',
			uploadError: new Error('storage down'),
		})
		h.adminClient = clients.admin
		const POST = await loadRoute()

		const res = await POST(makeRequest({ workspaceId: 'ws1', pages: [{ ...validPage }] }))
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.importedCount).toBe(0)
		expect(data.warnings).toHaveLength(1)
		expect(data.warnings[0].stage).toBe('snapshot')
		expect(data.warnings[0].error).toMatch(/storage down/)
		expect(indexPageMock).not.toHaveBeenCalled()
	})
})
