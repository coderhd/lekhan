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

		// T11 leak guard: legacy tokens are normalized before enforcement, so a
		// `go` (retired July INR tier) owner gets Plus limits — never the old
		// silent FREE_LIMITS fallback.
		expect(checkCanAddCollaborator(9, 'go')).toEqual({ canAdd: true, limit: 10 })
		expect(checkCanAddCollaborator(10, 'go')).toEqual({ canAdd: false, limit: 10 })
		expect(checkCanAddCollaborator(1, 'Go ')).toEqual({ canAdd: true, limit: 10 })
		// `enterprise` is out of H0 scope and normalizes to free.
		expect(checkCanAddCollaborator(2, 'enterprise')).toEqual({ canAdd: false, limit: 2 })

		// Pro cap collapsed from 100 to 25 in the single map.
		expect(checkCanAddCollaborator(24, 'pro')).toEqual({ canAdd: true, limit: 25 })
		expect(checkCanAddCollaborator(25, 'pro')).toEqual({ canAdd: false, limit: 25 })

		// Team without a seats source floors to 2; seats drive the cap otherwise.
		expect(checkCanAddCollaborator(1, 'team')).toEqual({ canAdd: true, limit: 2 })
		expect(checkCanAddCollaborator(2, 'team')).toEqual({ canAdd: false, limit: 2 })
		expect(checkCanAddCollaborator(4, 'team', 5)).toEqual({ canAdd: true, limit: 5 })
		expect(checkCanAddCollaborator(5, 'team', 5)).toEqual({ canAdd: false, limit: 5 })
	})
})
