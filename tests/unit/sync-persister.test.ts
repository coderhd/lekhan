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
		const uploadCalls = supabaseAdmin.storage.from().upload.mock.calls
		expect(uploadCalls.length).toBe(1)
		expect(uploadCalls[0][0]).toBe('doc-123/main_state.bin')
		// Explicitly verify binary payload is passed
		expect(uploadCalls[0][1]).toBeDefined()
		expect(uploadCalls[0][2]).toEqual({
			contentType: 'application/octet-stream',
			upsert: true,
		})
		
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

		// Assert storage upload and DB query still executed successfully
		expect(supabaseAdmin.storage.from().upload).toHaveBeenCalled()
		expect(supabaseAdmin.from).toHaveBeenCalledWith('pages')
	})

	it('TC02 (Variant): Handles resolved { success: false } from retention pruner', async () => {
		pruneExpiredMock.mockResolvedValueOnce({ success: false, error: 'Database timeout' })

		const persister = createTestPersister()
		const result = await persister.persist('doc-123', ydoc)

		expect(result.success).toBe(true)
		expect(result.nonCriticalResults.retentionSuccess).toBe(false)
		expect(result.nonCriticalResults.indexingSuccess).toBe(true)
	})

	it('TC03: Critical path failure handling for storage or database errors', async () => {
		// 1. Storage upload error rejects
		supabaseAdmin.storage.from().upload.mockResolvedValueOnce({ error: new Error('Storage down') })
		const persister = createTestPersister()
		
		await expect(persister.persist('doc-123', ydoc)).rejects.toThrow('Storage down')
		expect(indexPageMock).not.toHaveBeenCalled()

		// 2. Database update error rejects (on legacy doc fallback)
		supabaseAdmin.from = vi.fn().mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					maybeSingle: vi.fn().mockResolvedValue({ data: null })
				})
			}),
			update: vi.fn().mockReturnValue({
				eq: vi.fn().mockResolvedValue({ error: new Error('DB write failed') })
			})
		})
		supabaseAdmin.storage.from().upload.mockResolvedValueOnce({ error: null })
		
		await expect(persister.persist('doc-123', ydoc)).rejects.toThrow('DB write failed')
	})

	it('TC04: E2E mode awareness skips indexing', async () => {
		// Constructor-level E2E toggle
		const persister = createTestPersister({ isE2EEnabled: true })
		const result = await persister.persist('doc-123', ydoc)

		expect(result.success).toBe(true)
		expect(indexPageMock).not.toHaveBeenCalled()

		// Per-call E2E toggle override
		const standardPersister = createTestPersister({ isE2EEnabled: false })
		const perCallResult = await standardPersister.persist('doc-123', ydoc, { isE2EEnabled: true })

		expect(perCallResult.success).toBe(true)
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
