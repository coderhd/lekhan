import { describe, it, expect, vi, beforeEach } from 'vitest'
const {
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
		}
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

	it('handles database errors gracefully and returns fallback', async () => {
		mockSupabase.from.mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockResolvedValue({
					data: null,
					error: new Error('Postgres connection failed'),
				}),
			}),
		})

		const count = await getDistinctCollaboratorsCount(mockSupabase, 'doc-123')
		expect(count).toBe(0)
	})
})
