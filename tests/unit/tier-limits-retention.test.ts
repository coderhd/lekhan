import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPlanLimits, isExpiredVersion, getExpirationCutoffDate } from '../../lib/tier-limits'
import { pruneExpiredDocumentVersions } from '../../server/retention'

describe('tier-limits', () => {
	describe('getPlanLimits', () => {
		it('returns free limits by default', () => {
			expect(getPlanLimits()).toEqual({
				historyRetentionDays: 1,
				maxDistinctCollaborators: 2,
				maxStorageMb: 1000
			})
			expect(getPlanLimits('unknown')).toEqual({
				historyRetentionDays: 1,
				maxDistinctCollaborators: 2,
				maxStorageMb: 1000
			})
		})

		it('returns plus limits', () => {
			expect(getPlanLimits('plus')).toEqual({
				historyRetentionDays: 90,
				maxDistinctCollaborators: 10,
				maxStorageMb: 10000
			})
		})

		it('returns pro limits', () => {
			expect(getPlanLimits('pro')).toEqual({
				historyRetentionDays: 365,
				maxDistinctCollaborators: 100,
				maxStorageMb: 50000
			})
		})
	})

	describe('getExpirationCutoffDate', () => {
		it('computes correct cutoff date', () => {
			const now = new Date('2024-01-01T12:00:00Z')
			const freeCutoff = getExpirationCutoffDate('free', now)
			expect(freeCutoff.toISOString()).toBe('2023-12-31T12:00:00.000Z')

			const plusCutoff = getExpirationCutoffDate('plus', now)
			expect(plusCutoff.toISOString()).toBe('2023-10-03T12:00:00.000Z')

			const proCutoff = getExpirationCutoffDate('pro', now)
			expect(proCutoff.toISOString()).toBe('2023-01-01T12:00:00.000Z')
		})
	})

	describe('isExpiredVersion', () => {
		it('determines if a version is expired based on plan retention', () => {
			const now = new Date('2024-01-01T12:00:00Z')
			
			// Free plan (1 day retention)
			expect(isExpiredVersion('free', '2023-12-31T11:59:59Z', now)).toBe(true)
			expect(isExpiredVersion('free', '2023-12-31T12:00:01Z', now)).toBe(false)
			
			// Plus plan (90 days retention)
			expect(isExpiredVersion('plus', '2023-10-03T11:59:59Z', now)).toBe(true)
			expect(isExpiredVersion('plus', '2023-10-03T12:00:01Z', now)).toBe(false)

			// Pro plan (365 days retention)
			expect(isExpiredVersion('pro', '2023-01-01T11:59:59Z', now)).toBe(true)
			expect(isExpiredVersion('pro', '2023-01-01T12:00:01Z', now)).toBe(false)
		})
	})
})

describe('server/retention', () => {
	let mockSupabase: any
	
	beforeEach(() => {
		mockSupabase = {
			from: vi.fn().mockReturnThis(),
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			lt: vi.fn().mockReturnThis(),
			in: vi.fn().mockReturnThis(),
			delete: vi.fn().mockReturnThis(),
			storage: {
				from: vi.fn().mockReturnThis(),
				remove: vi.fn()
			}
		}
	})

	it('prunes expired document versions', async () => {
		const documentId = 'doc-123'
		const now = new Date('2024-01-01T12:00:00Z')
		
		const mockVersions = [
			{ id: 'v1' },
			{ id: 'v2' }
		]
		
		// Setup mocks
		mockSupabase.lt.mockResolvedValue({ data: mockVersions, error: null })
		mockSupabase.storage.from.mockReturnValue({
			remove: vi.fn().mockResolvedValue({ data: null, error: null })
		})
		mockSupabase.delete.mockReturnThis()
		mockSupabase.in.mockResolvedValue({ error: null })

		const result = await pruneExpiredDocumentVersions(mockSupabase, documentId, 'free', now)
		
		expect(result).toEqual({ prunedCount: 2, prunedIds: ['v1', 'v2'] })
		
		// Verify DB select call
		expect(mockSupabase.from).toHaveBeenCalledWith('document_versions')
		expect(mockSupabase.select).toHaveBeenCalledWith('id')
		expect(mockSupabase.eq).toHaveBeenCalledWith('document_id', 'doc-123')
		expect(mockSupabase.lt).toHaveBeenCalledWith('created_at', '2023-12-31T12:00:00.000Z')
		
		// Verify storage remove call
		expect(mockSupabase.storage.from).toHaveBeenCalledWith('documents')
		const removeMock = mockSupabase.storage.from().remove
		expect(removeMock).toHaveBeenCalledWith(['doc-123/versions/v1.bin', 'doc-123/versions/v2.bin'])
		
		// Verify DB delete call
		expect(mockSupabase.delete).toHaveBeenCalled()
		expect(mockSupabase.in).toHaveBeenCalledWith('id', ['v1', 'v2'])
	})
	
	it('returns 0 when no expired versions found', async () => {
		mockSupabase.lt.mockResolvedValue({ data: [], error: null })
		const result = await pruneExpiredDocumentVersions(mockSupabase, 'doc-123', 'free', new Date())
		expect(result).toEqual({ prunedCount: 0, prunedIds: [] })
		expect(mockSupabase.storage.from).not.toHaveBeenCalled()
		expect(mockSupabase.delete).not.toHaveBeenCalled()
	})
})
