import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
	supabase: {
		from: vi.fn(),
	},
}))

import { checkCanAddCollaborator, getPlanCollaboratorLimit } from '@/services/db'

describe('Plan Limit Enforcement Helpers', () => {
	it('returns correct collaborator limit per plan tier', () => {
		expect(getPlanCollaboratorLimit('free')).toBe(2)
		expect(getPlanCollaboratorLimit('go')).toBe(10)
		expect(getPlanCollaboratorLimit('pro')).toBe(25)
		expect(getPlanCollaboratorLimit('team')).toBe(50)
	})

	it('enforces collaborator count check correctly', () => {
		expect(checkCanAddCollaborator(1, 'free').canAdd).toBe(true)
		expect(checkCanAddCollaborator(2, 'free').canAdd).toBe(false)
		expect(checkCanAddCollaborator(9, 'go').canAdd).toBe(true)
		expect(checkCanAddCollaborator(10, 'go').canAdd).toBe(false)
	})
})
