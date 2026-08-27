import { describe, it, expect, vi, beforeEach } from 'vitest'
const {
	admitCollaborator,
	getDistinctCollaboratorsCount,
	isCollaboratorRegistered,
	recordCollaboratorAccess,
	getDistinctCollaboratorIds,
} = require('../../server/ledger.js')

describe('Collaborator Ledger Service', () => {
	let mockSupabase: any

	beforeEach(() => {
		mockSupabase = {
			from: vi.fn(),
			rpc: vi.fn(),
		}
	})

	it('admits anonymous users without database interaction', async () => {
		const result = await admitCollaborator(mockSupabase, 'doc-123', 'anonymous', 2)
		expect(result).toEqual({ allowed: true, is_registered: false })
		expect(mockSupabase.rpc).not.toHaveBeenCalled()
	})

	it('admits user via atomic database RPC when capacity is available', async () => {
		mockSupabase.rpc.mockResolvedValue({
			data: { allowed: true, is_registered: false, current_count: 1 },
			error: null,
		})

		const result = await admitCollaborator(mockSupabase, 'doc-123', 'user-1', 2)
		expect(result.allowed).toBe(true)
		expect(mockSupabase.rpc).toHaveBeenCalledWith('record_collaborator_if_capacity', {
			p_document_id: 'doc-123',
			p_user_id: 'user-1',
			p_max_collaborators: 2,
		})
	})

	it('rejects user via atomic database RPC when document is at capacity', async () => {
		mockSupabase.rpc.mockResolvedValue({
			data: { allowed: false, is_registered: false, current_count: 2 },
			error: null,
		})

		const result = await admitCollaborator(mockSupabase, 'doc-123', 'user-3', 2)
		expect(result.allowed).toBe(false)
	})

	it('propagates RPC database errors in admitCollaborator', async () => {
		mockSupabase.rpc.mockResolvedValue({
			data: null,
			error: { message: 'Database connection failure', code: '08006' },
		})

		await expect(admitCollaborator(mockSupabase, 'doc-123', 'user-1', 2)).rejects.toThrow()
	})

	it('throws fail-closed error if RPC returns 2xx with malformed data object', async () => {
		mockSupabase.rpc.mockResolvedValue({
			data: { invalid_key: true },
			error: null,
		})

		await expect(admitCollaborator(mockSupabase, 'doc-123', 'user-1', 2)).rejects.toThrow(
			'Malformed RPC response from record_collaborator_if_capacity'
		)
	})

	it('falls back to check-and-upsert sequence when RPC is undefined (PGRST202 / 42883)', async () => {
		mockSupabase.rpc.mockResolvedValue({
			data: null,
			error: { message: 'Could not find function in schema cache', code: 'PGRST202' },
		})
		mockSupabase.from.mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
					}),
					mockResolvedValue: vi.fn().mockResolvedValue({ data: [], error: null }),
				}),
			}),
			upsert: vi.fn().mockResolvedValue({ error: null }),
		})

		const result = await admitCollaborator(mockSupabase, 'doc-123', 'user-fallback', 2)
		expect(result).toHaveProperty('allowed')
	})

	it('returns distinct collaborator count from database', async () => {
		mockSupabase.from.mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockResolvedValue({
					data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
					error: null,
				}),
			}),
		})

		const count = await getDistinctCollaboratorsCount(mockSupabase, 'doc-123')
		expect(count).toBe(2)
		expect(mockSupabase.from).toHaveBeenCalledWith('document_collaborators_ledger')
	})

	it('checks if collaborator is registered', async () => {
		mockSupabase.from.mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { user_id: 'user-1' },
							error: null,
						}),
					}),
				}),
			}),
		})

		const isRegistered = await isCollaboratorRegistered(mockSupabase, 'doc-123', 'user-1')
		expect(isRegistered).toBe(true)
	})

	it('propagates database errors in isCollaboratorRegistered', async () => {
		mockSupabase.from.mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: null,
							error: new Error('Postgres read failed'),
						}),
					}),
				}),
			}),
		})

		await expect(isCollaboratorRegistered(mockSupabase, 'doc-123', 'user-1')).rejects.toThrow(
			'Postgres read failed'
		)
	})

	it('records new collaborator access into postgres ledger', async () => {
		const upsertMock = vi.fn().mockResolvedValue({ error: null })
		mockSupabase.from.mockReturnValue({
			upsert: upsertMock,
		})

		const result = await recordCollaboratorAccess(mockSupabase, 'doc-123', 'user-1')
		expect(result.success).toBe(true)
		expect(upsertMock).toHaveBeenCalledWith(
			expect.objectContaining({
				document_id: 'doc-123',
				user_id: 'user-1',
			}),
			expect.any(Object)
		)
	})

	it('propagates upsert errors in recordCollaboratorAccess', async () => {
		mockSupabase.from.mockReturnValue({
			upsert: vi.fn().mockResolvedValue({ error: new Error('Upsert conflict error') }),
		})

		await expect(recordCollaboratorAccess(mockSupabase, 'doc-123', 'user-1')).rejects.toThrow(
			'Upsert conflict error'
		)
	})

	it('propagates database errors instead of returning permissive fallbacks', async () => {
		mockSupabase.from.mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockResolvedValue({
					data: null,
					error: new Error('Postgres connection failed'),
				}),
			}),
		})

		await expect(getDistinctCollaboratorsCount(mockSupabase, 'doc-123')).rejects.toThrow(
			'Postgres connection failed'
		)
	})

	it('returns list of distinct collaborator IDs', async () => {
		mockSupabase.from.mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockResolvedValue({
					data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
					error: null,
				}),
			}),
		})

		const ids = await getDistinctCollaboratorIds(mockSupabase, 'doc-123')
		expect(ids).toEqual(['user-1', 'user-2'])
	})
})
