import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Mock the environment variables needed for server scripts
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key'

const wal = require('../server/wal')
const auth = require('../server/auth')

describe('Write-Ahead Log (WAL) Cache System', () => {
	const testDocId = 'test-doc-uuid'

	beforeEach(() => {
		// Clear updates before each test
		wal.clearUpdates(testDocId)
	})

	afterEach(() => {
		// Clean up final logs
		wal.clearUpdates(testDocId)
	})

	it('should append and retrieve updates correctly', () => {
		const update1 = new Uint8Array([1, 2, 3, 4])
		const update2 = new Uint8Array([5, 6, 7, 8])

		wal.appendUpdate(testDocId, update1)
		wal.appendUpdate(testDocId, update2)

		const pending = wal.getPendingUpdates(testDocId)
		expect(pending.length).toBe(2)
		expect(Array.from(pending[0])).toEqual([1, 2, 3, 4])
		expect(Array.from(pending[1])).toEqual([5, 6, 7, 8])
	})

	it('should return empty list when no updates exist', () => {
		const pending = wal.getPendingUpdates('non-existent-doc')
		expect(pending).toEqual([])
	})

	it('should clear updates when requested', () => {
		const update = new Uint8Array([1, 2, 3])
		wal.appendUpdate(testDocId, update)
		
		let pending = wal.getPendingUpdates(testDocId)
		expect(pending.length).toBe(1)

		wal.clearUpdates(testDocId)
		pending = wal.getPendingUpdates(testDocId)
		expect(pending).toEqual([])
	})
})

describe('Server Authentication & Role Verification System', () => {
	it('should initialize supabase client with correct headers', () => {
		const client = auth.getSupabaseClient('mock-user-jwt')
		expect(client).toBeDefined()
	})

	it('should return null when no user session is present', async () => {
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
			},
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'doc-id')
		expect(role).toBeNull()
	})

	it('should return "owner" when user matches document owner_id', async () => {
		const mockUser = { id: 'user-123' }
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						single: vi.fn().mockResolvedValue({ data: { owner_id: 'user-123' }, error: null }),
					}),
				}),
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'doc-id')
		expect(role).toBe('owner')
	})

	it('should return member role when user is collaborator but not owner', async () => {
		const mockUser = { id: 'user-123' }
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
			},
			from: vi.fn().mockImplementation((table) => {
				if (table === 'documents') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								single: vi.fn().mockResolvedValue({ data: { owner_id: 'different-owner' }, error: null }),
							}),
						}),
					}
				}
				if (table === 'document_members') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								eq: vi.fn().mockReturnValue({
									single: vi.fn().mockResolvedValue({ data: { role: 'editor' }, error: null }),
								}),
							}),
						}),
					}
				}
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'doc-id')
		expect(role).toBe('editor')
	})
})
