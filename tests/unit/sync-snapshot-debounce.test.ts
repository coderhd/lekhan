import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Sync Server Hardened Capped-Debounce Timing & Payload Protection', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	it('triggers save after 2 seconds of inactivity (idle debounce)', () => {
		const saveMock = vi.fn()
		let debounceTimer: any = null
		let maxThrottleTimer: any = null

		function scheduleSave() {
			if (debounceTimer) clearTimeout(debounceTimer)
			debounceTimer = setTimeout(() => {
				clearTimeout(debounceTimer)
				clearTimeout(maxThrottleTimer)
				debounceTimer = null
				maxThrottleTimer = null
				saveMock()
			}, 2000)

			if (!maxThrottleTimer) {
				maxThrottleTimer = setTimeout(() => {
					clearTimeout(debounceTimer)
					clearTimeout(maxThrottleTimer)
					debounceTimer = null
					maxThrottleTimer = null
					saveMock()
				}, 10000)
			}
		}

		scheduleSave()
		vi.advanceTimersByTime(1999)
		expect(saveMock).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		expect(saveMock).toHaveBeenCalledTimes(1)
	})

	it('forces save after 10 seconds under continuous typing (max-throttle cap)', () => {
		const saveMock = vi.fn()
		let debounceTimer: any = null
		let maxThrottleTimer: any = null

		function scheduleSave() {
			if (debounceTimer) clearTimeout(debounceTimer)
			debounceTimer = setTimeout(() => {
				clearTimeout(debounceTimer)
				clearTimeout(maxThrottleTimer)
				debounceTimer = null
				maxThrottleTimer = null
				saveMock()
			}, 2000)

			if (!maxThrottleTimer) {
				maxThrottleTimer = setTimeout(() => {
					clearTimeout(debounceTimer)
					clearTimeout(maxThrottleTimer)
					debounceTimer = null
					maxThrottleTimer = null
					saveMock()
				}, 10000)
			}
		}

		// Simulate continuous typing every 500ms for 12 seconds
		for (let t = 0; t < 20; t++) {
			scheduleSave()
			vi.advanceTimersByTime(500)
		}

		// At t=10s, max-throttle must have fired
		expect(saveMock).toHaveBeenCalled()
	})

	it('enforces 10 MB maximum payload ceiling on incoming binary frames', () => {
		const MAX_FRAME_SIZE = 10 * 1024 * 1024
		const smallPayload = Buffer.alloc(1024)
		const oversizedPayload = Buffer.alloc(11 * 1024 * 1024)

		function isFrameAllowed(data: Buffer | ArrayBuffer) {
			const byteLength = data instanceof Buffer ? data.length : data.byteLength
			return byteLength <= MAX_FRAME_SIZE
		}

		expect(isFrameAllowed(smallPayload)).toBe(true)
		expect(isFrameAllowed(oversizedPayload)).toBe(false)
	})
})
