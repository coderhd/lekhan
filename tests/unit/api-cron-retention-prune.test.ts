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

	it('rejects authentication attempts using query parameters', async () => {
		const { POST } = await import('@/app/api/cron/retention-prune/route')
		const req = new NextRequest(
			'http://localhost:3000/api/cron/retention-prune?key=test-cron-secret-key-123',
			{
				method: 'POST',
			}
		)

		const res = await POST(req)
		expect(res.status).toBe(401)
		const data = await res.json()
		expect(data.error).toBe('Unauthorized')
	})

	it('executes batch retention pruning when authorized with valid CRON_SECRET', async () => {
		const mockSupabase = {
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockImplementation((fields: string) => {
							if (fields === 'id') {
								return {
									range: vi.fn().mockImplementation((start: number) => {
										if (start === 0) {
											return Promise.resolve({
												data: [{ id: 'doc-1' }],
												error: null,
											})
										}
										return Promise.resolve({
											data: [],
											error: null,
										})
									}),
								}
							}
							return {
								eq: vi.fn().mockReturnValue({
									maybeSingle: vi.fn().mockResolvedValue({
										data: { owner_id: 'user-1' },
										error: null,
									}),
								}),
							}
						}),
					}
				}
				if (table === 'document_versions') {
					return {
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
					}
				}
				if (table === 'profiles') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: { plan: 'free' },
									error: null,
								}),
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

	it('returns non-2xx status code when any document prune encounters an error', async () => {
		const mockSupabase = {
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockImplementation((fields: string) => {
							if (fields === 'id') {
								return {
									range: vi.fn().mockResolvedValue({
										data: [{ id: 'doc-failed-1' }],
										error: null,
									}),
								}
							}
							return {
								eq: vi.fn().mockReturnValue({
									maybeSingle: vi.fn().mockResolvedValue({
										data: { owner_id: 'user-1' },
										error: null,
									}),
								}),
							}
						}),
					}
				}
				if (table === 'document_versions') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								lt: vi.fn().mockResolvedValue({
									data: null,
									error: new Error('Version fetch error'),
								}),
							}),
						}),
					}
				}
				if (table === 'profiles') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: { plan: 'free' },
									error: null,
								}),
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
		expect(res.status).toBe(500)
		const data = await res.json()
		expect(data.success).toBe(false)
		expect(data.failedDocumentIds).toContain('doc-failed-1')
	})
})
