import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { detectHardwareProfile, getHardwareRecommendation } from '../../lib/ai/hardware'

describe('detectHardwareProfile', () => {
	beforeEach(() => {
		vi.stubGlobal('window', {})
		vi.stubGlobal('navigator', {})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('handles Node/SSR gracefully', async () => {
		vi.stubGlobal('window', undefined)
		vi.stubGlobal('navigator', undefined)
		
		const profile = await detectHardwareProfile()
		expect(profile.tier).toBe('medium')
		expect(profile.ramGb).toBe(8)
		expect(profile.cpuCores).toBe(4)
		expect(profile.hasWebGPU).toBe(false)
	})

	it('detects light tier correctly (<8GB RAM)', async () => {
		vi.stubGlobal('navigator', {
			deviceMemory: 4,
			hardwareConcurrency: 4
		})
		const profile = await detectHardwareProfile()
		expect(profile.tier).toBe('light')
		expect(profile.ramGb).toBe(4)
		expect(profile.recommendedMaxLocalModelSize).toBe('Cloud / 1B only')
	})

	it('detects medium tier correctly (8-16GB RAM)', async () => {
		vi.stubGlobal('navigator', {
			deviceMemory: 8,
			hardwareConcurrency: 8
		})
		const profile = await detectHardwareProfile()
		expect(profile.tier).toBe('medium')
		expect(profile.ramGb).toBe(8)
		expect(profile.recommendedMaxLocalModelSize).toBe('3B–8B')
	})

	it('detects heavy tier correctly (>=16GB RAM)', async () => {
		vi.stubGlobal('navigator', {
			deviceMemory: 16,
			hardwareConcurrency: 12
		})
		const profile = await detectHardwareProfile()
		expect(profile.tier).toBe('heavy')
		expect(profile.ramGb).toBe(16)
		expect(profile.recommendedMaxLocalModelSize).toBe('14B–32B')
	})

	it('detects WebGPU when available', async () => {
		const mockAdapter = {
			vendor: 'apple',
			architecture: 'apple-m2'
		}
		const requestAdapterMock = vi.fn().mockResolvedValue(mockAdapter)
		
		vi.stubGlobal('navigator', {
			deviceMemory: 32,
			hardwareConcurrency: 16,
			gpu: {
				requestAdapter: requestAdapterMock
			}
		})
		
		const profile = await detectHardwareProfile()
		expect(profile.hasWebGPU).toBe(true)
		expect(profile.gpuVendor).toBe('apple')
		expect(profile.gpuRenderer).toBe('apple-m2')
	})
})

describe('getHardwareRecommendation', () => {
	it('returns secondary badge and warning for light tier', () => {
		const rec = getHardwareRecommendation({
			tier: 'light',
			ramGb: 4,
			cpuCores: 4,
			hasWebGPU: false,
			label: 'test',
			recommendedMaxLocalModelSize: 'test'
		})
		expect(rec.isLocalFeasible).toBe(false)
		expect(rec.badgeVariant).toBe('secondary')
		expect(rec.badgeText).toBe('Cloud Recommended')
		expect(rec.warning).toBe('Running models locally may slow down your system. We recommend using free cloud models.')
	})

	it('returns default badge for medium tier', () => {
		const rec = getHardwareRecommendation({
			tier: 'medium',
			ramGb: 8,
			cpuCores: 8,
			hasWebGPU: false,
			label: 'test',
			recommendedMaxLocalModelSize: 'test'
		})
		expect(rec.isLocalFeasible).toBe(true)
		expect(rec.badgeVariant).toBe('default')
		expect(rec.badgeText).toBe('Optimal for 3B–8B')
		expect(rec.warning).toBeUndefined()
	})

	it('returns default badge for heavy tier', () => {
		const rec = getHardwareRecommendation({
			tier: 'heavy',
			ramGb: 32,
			cpuCores: 16,
			hasWebGPU: true,
			label: 'test',
			recommendedMaxLocalModelSize: 'test'
		})
		expect(rec.isLocalFeasible).toBe(true)
		expect(rec.badgeVariant).toBe('default')
		expect(rec.badgeText).toBe('High Performance (14B+)')
		expect(rec.warning).toBeUndefined()
	})
})
