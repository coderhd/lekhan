import { describe, it, expect } from 'vitest'
const { getServerMetrics } = require('../../server/index.js')

describe('Sync Server Health, Metrics & Load Shedding', () => {
	it('returns formatted health metrics matching the schema', () => {
		const metrics = getServerMetrics()

		expect(metrics).toHaveProperty('status', 'ok')
		expect(metrics).toHaveProperty('uptimeSeconds')
		expect(metrics).toHaveProperty('activeDocuments')
		expect(metrics).toHaveProperty('activeConnections')
		expect(metrics).toHaveProperty('memory')
		expect(metrics.memory).toHaveProperty('rssMb')
		expect(metrics.memory).toHaveProperty('heapUsedMb')
		expect(metrics.memory).toHaveProperty('heapTotalMb')
		expect(metrics).toHaveProperty('limits')
		expect(metrics.limits).toHaveProperty('maxConnections', 1500)
		expect(metrics.limits).toHaveProperty('heapUtilizationPct')
	})

	it('computes heap utilization percentage correctly', () => {
		const metrics = getServerMetrics()
		expect(typeof metrics.limits.heapUtilizationPct).toBe('number')
		expect(metrics.limits.heapUtilizationPct).toBeGreaterThanOrEqual(0)
		expect(metrics.limits.heapUtilizationPct).toBeLessThanOrEqual(100)
	})
})
