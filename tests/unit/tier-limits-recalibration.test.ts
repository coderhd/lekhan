import { describe, it, expect } from 'vitest'
import { getPlanLimits } from '@/lib/tier-limits'

describe('Tier Limits Recalibration', () => {
	it('recalibrates free tier storage quota to 20 MB', () => {
		const freeLimits = getPlanLimits('free')
		expect(freeLimits.maxStorageMb).toBe(20)
		expect(freeLimits.historyRetentionDays).toBe(1)
		expect(freeLimits.maxDistinctCollaborators).toBe(2)
	})

	it('preserves plus and pro limits', () => {
		const plusLimits = getPlanLimits('plus')
		expect(plusLimits.maxStorageMb).toBe(10000)
		const proLimits = getPlanLimits('pro')
		expect(proLimits.maxStorageMb).toBe(50000)
	})
})
