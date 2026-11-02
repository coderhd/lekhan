import { describe, it, expect } from 'vitest'
const { getServerMetrics, readHeapPressure, HEAP_SHED_RATIO } = require('../../server/index.js')

describe('Sync Server Health, Metrics & Load Shedding', () => {
	it('returns formatted health metrics matching the schema', () => {
		const metrics = getServerMetrics()

		expect(metrics).toHaveProperty('status')
		expect(metrics).toHaveProperty('uptimeSeconds')
		expect(metrics).toHaveProperty('activeDocuments')
		expect(metrics).toHaveProperty('activeConnections')
		expect(metrics).toHaveProperty('pendingUpgrades')
		expect(metrics).toHaveProperty('memory')
		expect(metrics.memory).toHaveProperty('rssMb')
		expect(metrics.memory).toHaveProperty('heapUsedMb')
		expect(metrics.memory).toHaveProperty('heapTotalMb')
		expect(metrics.memory).toHaveProperty('heapLimitMb')
		expect(metrics).toHaveProperty('limits')
		expect(metrics.limits).toHaveProperty('maxConnections', 1500)
		expect(metrics.limits).toHaveProperty('heapShedRatio', HEAP_SHED_RATIO)
		expect(metrics.limits).toHaveProperty('heapUtilizationPct')
		expect(metrics.limits).toHaveProperty('isShedding')
	})

	it('computes heap utilization percentage correctly', () => {
		const metrics = getServerMetrics()
		expect(typeof metrics.limits.heapUtilizationPct).toBe('number')
		expect(metrics.limits.heapUtilizationPct).toBeGreaterThanOrEqual(0)
		expect(metrics.limits.heapUtilizationPct).toBeLessThanOrEqual(100)
	})

	it('measures pressure against the V8 heap limit, not the lazy heapTotal (SIL-214 F3)', () => {
		const pressure = readHeapPressure()

		// The limit is the ceiling V8 will grow to; heapTotal is only what has
		// been committed so far, so it can never exceed the limit.
		expect(pressure.heapLimit).toBeGreaterThan(0)
		// A healthy idle process must not be "exhausted" just because its
		// committed heap is small.
		expect(pressure.utilization).toBeLessThan(HEAP_SHED_RATIO)
		expect(pressure.isMemoryExhausted).toBe(false)
		expect(getServerMetrics().status).toBe('ok')
	})
})
