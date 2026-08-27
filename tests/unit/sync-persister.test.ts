import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { createPagePersister } from '../../server/persister'


describe('Hub Page Persister (server/persister.js)', () => {
	let supabaseAdmin: any
	let ydoc: Y.Doc
	let indexPageMock: any
	let pruneExpiredMock: any
	let getDocumentOwnerPlanMock: any

	beforeEach(() => {
		indexPageMock = vi.fn().mockResolvedValue(true)
		pruneExpiredMock = vi.fn().mockResolvedValue({ prunedCount: 0 })
		getDocumentOwnerPlanMock = vi.fn().mockResolvedValue('pro')

		ydoc = new Y.Doc()
		ydoc.getText('default').insert(0, 'Hello from persister')

		supabaseAdmin = {
			storage: {
				from: vi.fn().mockReturnValue({
					upload: vi.fn().mockResolvedValue({ error: null })
				})
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'doc-123' } })
					})
				}),
				update: vi.fn().mockReturnValue({
					eq: vi.fn().mockResolvedValue({ error: null })
				})
			})
		}
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	function createTestPersister(overrides = {}) {
		return createPagePersister({
			supabaseAdmin,
			indexer: { indexPage: indexPageMock },
			retentionEngine: { pruneExpiredDocumentVersions: pruneExpiredMock },
			authService: { getDocumentOwnerPlan: getDocumentOwnerPlanMock },
			...overrides,
		})
	}

	it('TC01: Atomic persistence pipeline execution', async () => {
		const persister = createTestPersister()
		const result = await persister.persist('doc-123', ydoc)

		expect(result.success).toBe(true)
		expect(result.documentId).toBe('doc-123')
		expect(result.nonCriticalResults.indexingSuccess).toBe(true)
		expect(result.nonCriticalResults.retentionSuccess).toBe(true)

		expect(supabaseAdmin.storage.from).toHaveBeenCalledWith('documents')
		const uploadArgs = supabaseAdmin.storage.from().upload.mock.calls[0]
		expect(uploadArgs[0]).toBe('doc-123/main_state.bin')
		
		expect(indexPageMock).toHaveBeenCalledWith(supabaseAdmin, 'doc-123', 'Hello from persister')
		expect(getDocumentOwnerPlanMock).toHaveBeenCalledWith(supabaseAdmin, 'doc-123')
		expect(pruneExpiredMock).toHaveBeenCalledWith(supabaseAdmin, 'doc-123', 'pro', expect.any(Date))
	})

	it('TC02: Error boundary isolation for graph index and retention', async () => {
		indexPageMock.mockRejectedValueOnce(new Error('Index failed'))
		pruneExpiredMock.mockRejectedValueOnce(new Error('Retention failed'))

		const persister = createTestPersister()
		const result = await persister.persist('doc-123', ydoc)

		expect(result.success).toBe(true)
		expect(result.nonCriticalResults.indexingSuccess).toBe(false)
		expect(result.nonCriticalResults.retentionSuccess).toBe(false)
	})

	it('TC03: Storage failure handling aborts the pipeline', async () => {
		supabaseAdmin.storage.from().upload.mockResolvedValueOnce({ error: new Error('Storage down') })

		const persister = createTestPersister()
		
		await expect(persister.persist('doc-123', ydoc)).rejects.toThrow('Storage down')
		expect(indexPageMock).not.toHaveBeenCalled()
	})

	it('TC04: E2E mode awareness skips indexing', async () => {
		const persister = createTestPersister({ isE2EEnabled: true })
		const result = await persister.persist('doc-123', ydoc)

		expect(result.success).toBe(true)
		expect(indexPageMock).not.toHaveBeenCalled()
	})

	it('TC05: Direct unit testability without WebSocket server (Legacy fallback path)', async () => {
		supabaseAdmin.from = vi.fn().mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					maybeSingle: vi.fn().mockResolvedValue({ data: null })
				})
			}),
			update: vi.fn().mockReturnValue({
				eq: vi.fn().mockResolvedValue({ error: null })
			})
		})

		const persister = createTestPersister()
		const result = await persister.persist('doc-123', ydoc)

		expect(result.success).toBe(true)
		expect(supabaseAdmin.from).toHaveBeenCalledWith('documents')
		
		const updateMock = supabaseAdmin.from().update
		expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
			searchable_text: 'Hello from persister',
			updated_at: expect.any(String)
		}))
	})
})
