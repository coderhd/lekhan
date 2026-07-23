import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
	supabase: {
		from: vi.fn((table: string) => {
			if (table === 'documents') {
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: { owner_id: 'owner-1', profiles: { id: 'owner-1', email: 'owner@test.com', full_name: 'Owner User' } },
						error: null,
					}),
				}
			}
			if (table === 'document_members') {
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					in: vi.fn().mockResolvedValue({
						data: [
							{ user_id: 'ed-1', role: 'editor', profiles: { id: 'ed-1', email: 'editor@test.com', full_name: 'Editor User' } },
						],
						error: null,
					}),
				}
			}
			return {}
		}),
	},
}))

import { fetchMentionableCollaborators } from '@/services/db'

describe('fetchMentionableCollaborators', () => {
	it('fetches owner and editors for a document excluding viewers', async () => {
		const collaborators = await fetchMentionableCollaborators('doc-123')
		expect(collaborators).toEqual([
			{ id: 'owner-1', email: 'owner@test.com', full_name: 'Owner User' },
			{ id: 'ed-1', email: 'editor@test.com', full_name: 'Editor User' },
		])
	})
})
