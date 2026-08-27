import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'

describe('Sync Server Hardened Capped-Debounce Timing & Serialization', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	it('serializes concurrent saves for the same document and returns deduplicated promise', async () => {
		const { triggerSerializedSave } = require('../../server/index.js')
		const ydoc = new Y.Doc()
		ydoc.getText('default').insert(0, 'Hello world')

		// Trigger two saves in rapid succession
		const p1 = triggerSerializedSave('doc-serialize-1', ydoc)
		const p2 = triggerSerializedSave('doc-serialize-1', ydoc)

		// P2 should return the existing in-flight promise
		expect(p2).toBe(p1)

		await vi.advanceTimersByTimeAsync(150)
		await Promise.allSettled([p1, p2])
	})

	it('pins 2-second idle debounce duration exactly', async () => {
		const {
			scheduleDebouncedSave,
			saveDebounceTimers,
			saveMaxThrottleTimers,
			clearSaveTimers,
		} = require('../../server/index.js')

		const docId = 'doc-idle-timer-test'
		const ydoc = new Y.Doc()
		ydoc.getText('default').insert(0, 'Typing...')

		clearSaveTimers(docId)
		scheduleDebouncedSave(docId, ydoc)

		// At 1999ms, timers must still be active
		await vi.advanceTimersByTimeAsync(1999)
		expect(saveDebounceTimers.has(docId)).toBe(true)
		expect(saveMaxThrottleTimers.has(docId)).toBe(true)

		// At 2000ms, idle debounce fires and clears both timers
		await vi.advanceTimersByTimeAsync(1)
		expect(saveDebounceTimers.has(docId)).toBe(false)
		expect(saveMaxThrottleTimers.has(docId)).toBe(false)
	})

	it('pins 10-second max-throttle cap duration under continuous updates', async () => {
		const {
			scheduleDebouncedSave,
			saveDebounceTimers,
			saveMaxThrottleTimers,
			clearSaveTimers,
		} = require('../../server/index.js')

		const docId = 'doc-max-throttle-test'
		const ydoc = new Y.Doc()

		clearSaveTimers(docId)

		// Simulate continuous typing every 1s for 9 seconds (resets idle debounce each second)
		for (let s = 0; s < 9; s++) {
			scheduleDebouncedSave(docId, ydoc)
			await vi.advanceTimersByTimeAsync(1000)
			expect(saveMaxThrottleTimers.has(docId)).toBe(true)
		}

		// Re-trigger at second 9 (advance 999ms) -> at 9999ms max throttle has not fired yet
		scheduleDebouncedSave(docId, ydoc)
		await vi.advanceTimersByTimeAsync(999)
		expect(saveMaxThrottleTimers.has(docId)).toBe(true)

		// Advance 1ms to reach t = 10,000ms -> max throttle fires and clears timers
		await vi.advanceTimersByTimeAsync(1)
		expect(saveMaxThrottleTimers.has(docId)).toBe(false)
		expect(saveDebounceTimers.has(docId)).toBe(false)
	})

	it('enforces 10 MB maximum payload ceiling constant on incoming frames', () => {
		const { MAX_PAYLOAD_BYTES, wss } = require('../../server/index.js')
		expect(MAX_PAYLOAD_BYTES).toBe(10 * 1024 * 1024)
		expect(wss.options.maxPayload).toBe(10 * 1024 * 1024)
	})
})
