import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

describe('POST /api/cron/retention-prune', () => {
	beforeEach(() => {
		vi.resetModules()
		process.env.CRON_SECRET = 'test-cron-secret-key-123'
		process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co'
		process.env.SUPABASE_SECRET_KEY = 'mock-secret-key'
	})

	it('returns 401 Unauthorized when Bearer token is missing or invalid', async () => {
		const { POST } = await import('@/app/api/cron/retention-prune/route')
		const req = new NextRequest('http://localhost:3000/api/cron/retention-prune', {
			method: 'POST',
			headers: { authorization: 'Bearer invalid-token' },
		})

		const res = await POST(req)
		expect(res.status).toBe(401)
		const data = await res.json()
		expect(data.error).toBe('Unauthorized')
	})

	it('executes global retention pruning when authorized with valid CRON_SECRET', async () => {
		const selectVersionsMock = vi.fn().mockReturnValue({
			order: vi.fn().mockResolvedValue({
				data: [{ document_id: 'doc-1' }],
				error: null,
			}),
		})

		const selectLtMock = vi.fn().mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					lt: vi.fn().mockResolvedValue({
						data: [{ id: 'v1' }, { id: 'v2' }],
						error: null,
					}),
				}),
			}),
			delete: vi.fn().mockReturnValue({
				in: vi.fn().mockResolvedValue({ error: null }),
			}),
		})

		const mockSupabase = {
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'document_versions') {
					return {
						select: vi.fn().mockImplementation((fields: string) => {
							if (fields === 'document_id') {
								return {
									order: vi.fn().mockResolvedValue({
										data: [{ document_id: 'doc-1' }],
										error: null,
									}),
								}
							}
							return {
								eq: vi.fn().mockReturnValue({
									lt: vi.fn().mockResolvedValue({
										data: [{ id: 'v1' }, { id: 'v2' }],
										error: null,
									}),
								}),
							}
						}),
						delete: vi.fn().mockReturnValue({
							in: vi.fn().mockResolvedValue({ error: null }),
						}),
					}
				}
				if (table === 'pages') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({ data: { owner_id: 'user-1' }, error: null }),
							}),
						}),
					}
				}
				if (table === 'profiles') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({ data: { plan: 'free' }, error: null }),
							}),
						}),
					}
				}
				return {}
			}),
			storage: {
				from: vi.fn().mockReturnValue({
					remove: vi.fn().mockResolvedValue({ data: null, error: null }),
				}),
			},
		}

		vi.doMock('@supabase/supabase-js', () => ({
			createClient: vi.fn().mockReturnValue(mockSupabase),
		}))

		const { POST } = await import('@/app/api/cron/retention-prune/route')
		const req = new NextRequest('http://localhost:3000/api/cron/retention-prune', {
			method: 'POST',
			headers: { authorization: 'Bearer test-cron-secret-key-123' },
		})

		const res = await POST(req)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.success).toBe(true)
		expect(data.prunedDocumentsCount).toBe(1)
		expect(data.prunedVersionsCount).toBe(2)
	})
})
