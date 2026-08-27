import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST, GET } from '@/app/api/version/route'
import { isEncryptedSnapshot, decryptSnapshot } from '@/lib/server-crypto'

const h = vi.hoisted(() => {
	const callerClient = {
		auth: {
			getUser: vi.fn(async () => ({
				data: { user: { id: 'user-1', email: 'user@example.com' } },
				error: null,
			})),
		},
		from: vi.fn(),
	}

	const storageUploaded = new Map<string, Buffer>()
	const storageMock = {
		from: vi.fn(() => ({
			upload: vi.fn(async (path: string, buffer: Buffer) => {
				storageUploaded.set(path, Buffer.from(buffer))
				return { error: null }
			}),
			download: vi.fn(async (path: string) => {
				const buf = storageUploaded.get(path)
				if (!buf) {
					return { data: null, error: { message: 'Not found' } }
				}
				return {
					data: {
						arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
					},
					error: null,
				}
			}),
		})),
	}

	const adminClient = {
		from: vi.fn(),
		storage: storageMock,
	}

	return { callerClient, adminClient, storageUploaded }
})

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn((_url: string, key: string) => {
		// If service role key was used (admin client)
		if (key === 'service-role-key' || key === process.env.SUPABASE_SECRET_KEY) {
			return h.adminClient
		}
		// Otherwise caller client
		return h.callerClient
	}),
}))

describe('/api/version endpoint (encrypted snapshots at rest)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		h.storageUploaded.clear()
		process.env.LEKHAN_ENCRYPTION_KEY = 'test-version-encryption-key-32b!'
		process.env.SUPABASE_SECRET_KEY = 'service-role-key'

		// Default DB responses
		h.adminClient.from.mockImplementation((table: string) => {
			if (table === 'pages') {
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					maybeSingle: vi.fn(async () => ({
						data: { id: 'page-123', owner_id: 'user-1', is_public: false },
						error: null,
					})),
				}
			}
			return {}
		})

		h.callerClient.from.mockImplementation((table: string) => {
			if (table === 'pages') {
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					maybeSingle: vi.fn(async () => ({
						data: { id: 'page-123', owner_id: 'user-1' },
						error: null,
					})),
				}
			}
			if (table === 'document_versions') {
				return {
					insert: vi.fn().mockReturnValue({
						select: vi.fn().mockReturnValue({
							single: vi.fn(async () => ({
								data: {
									id: 'ver-abc-123',
									page_id: 'page-123',
									version_name: 'Checkpoint 1',
								},
								error: null,
							})),
						}),
					}),
					delete: vi.fn().mockReturnThis(),
					eq: vi.fn().mockResolvedValue({ error: null }),
				}
			}
			return {}
		})
	})

	it('POST /api/version encrypts the binary snapshot and writes to storage', async () => {
		const rawYjsState = Buffer.from('binary-yjs-state-v1')
		const req = new NextRequest('http://localhost/api/version', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-token',
			},
			body: JSON.stringify({
				documentId: 'page-123',
				versionName: 'Draft 1',
				base64State: rawYjsState.toString('base64'),
			}),
		})

		const res = await POST(req)
		expect(res.status).toBe(200)

		const data = await res.json()
		expect(data.success).toBe(true)
		expect(data.version.id).toBe('ver-abc-123')

		// Verify stored snapshot is encrypted
		const storedBuffer = h.storageUploaded.get('page-123/versions/ver-abc-123.bin')
		expect(storedBuffer).toBeDefined()
		expect(isEncryptedSnapshot(storedBuffer!)).toBe(true)
		expect(decryptSnapshot(storedBuffer!)).toEqual(rawYjsState)
	})

	it('GET /api/version decrypts and returns the binary snapshot for authorized user', async () => {
		const rawYjsState = Buffer.from('binary-yjs-state-v1')

		// Save first
		const postReq = new NextRequest('http://localhost/api/version', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-token',
			},
			body: JSON.stringify({
				documentId: 'page-123',
				versionName: 'Draft 1',
				base64State: rawYjsState.toString('base64'),
			}),
		})
		await POST(postReq)

		// Fetch via GET
		const getReq = new NextRequest(
			'http://localhost/api/version?documentId=page-123&versionId=ver-abc-123',
			{
				method: 'GET',
				headers: {
					Authorization: 'Bearer test-token',
				},
			}
		)

		const getRes = await GET(getReq)
		expect(getRes.status).toBe(200)
		expect(getRes.headers.get('Content-Type')).toBe('application/octet-stream')

		const arrayBuf = await getRes.arrayBuffer()
		const receivedData = Buffer.from(arrayBuf)
		expect(receivedData).toEqual(rawYjsState)
	})

	it('GET /api/version rejects unauthorized users with 403', async () => {
		// Mock non-owner non-member
		h.adminClient.from.mockImplementation((table: string) => {
			if (table === 'pages') {
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					maybeSingle: vi.fn(async () => ({
						data: { id: 'page-123', owner_id: 'other-owner', is_public: false },
						error: null,
					})),
				}
			}
			return {}
		})
		h.callerClient.from.mockImplementation((table: string) => {
			if (table === 'page_members') {
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					maybeSingle: vi.fn(async () => ({ data: null, error: null })),
				}
			}
			return {}
		})

		const getReq = new NextRequest(
			'http://localhost/api/version?documentId=page-123&versionId=ver-abc-123',
			{
				method: 'GET',
				headers: {
					Authorization: 'Bearer test-token',
				},
			}
		)

		const getRes = await GET(getReq)
		expect(getRes.status).toBe(403)
	})
})
