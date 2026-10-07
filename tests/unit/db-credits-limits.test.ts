import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
	supabase: {
		from: vi.fn(),
	},
}))

import { checkCanAddCollaborator, getPlanMaxDocuments } from '@/services/db'

describe('Plan Limit Enforcement Helpers', () => {
	it('returns correct document limit per plan tier', () => {
		expect(getPlanMaxDocuments('free')).toBe(5)
		expect(getPlanMaxDocuments('go')).toBe(Infinity)
		expect(getPlanMaxDocuments('pro')).toBe(Infinity)
		expect(getPlanMaxDocuments('team')).toBe(Infinity)
	})

	it('enforces collaborator count against the single tier-limits map', () => {
		// Free cap unchanged.
		expect(checkCanAddCollaborator(1, 'free')).toEqual({ canAdd: true, limit: 2 })
		expect(checkCanAddCollaborator(2, 'free')).toEqual({ canAdd: false, limit: 2 })

		// Legacy/unknown tokens fall through to FREE_LIMITS (normalized ingress is T11).
		expect(checkCanAddCollaborator(1, 'go')).toEqual({ canAdd: true, limit: 2 })
		expect(checkCanAddCollaborator(2, 'go')).toEqual({ canAdd: false, limit: 2 })
		expect(checkCanAddCollaborator(2, 'enterprise')).toEqual({ canAdd: false, limit: 2 })

		// Pro cap collapsed from 100 to 25 in the single map.
		expect(checkCanAddCollaborator(24, 'pro')).toEqual({ canAdd: true, limit: 25 })
		expect(checkCanAddCollaborator(25, 'pro')).toEqual({ canAdd: false, limit: 25 })

		// Team without a seats source floors to 2.
		expect(checkCanAddCollaborator(1, 'team')).toEqual({ canAdd: true, limit: 2 })
		expect(checkCanAddCollaborator(2, 'team')).toEqual({ canAdd: false, limit: 2 })
	})
})
