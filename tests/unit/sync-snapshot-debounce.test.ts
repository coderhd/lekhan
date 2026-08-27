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

	it('schedules 2-second idle debounce and 10-second max-throttle timers on document changes', () => {
		const {
			scheduleDebouncedSave,
			saveDebounceTimers,
			saveMaxThrottleTimers,
			clearSaveTimers,
		} = require('../../server/index.js')

		const docId = 'doc-timer-test-1'
		const ydoc = new Y.Doc()
		ydoc.getText('default').insert(0, 'Typing...')

		clearSaveTimers(docId)
		expect(saveDebounceTimers.has(docId)).toBe(false)
		expect(saveMaxThrottleTimers.has(docId)).toBe(false)

		scheduleDebouncedSave(docId, ydoc)
		expect(saveDebounceTimers.has(docId)).toBe(true)
		expect(saveMaxThrottleTimers.has(docId)).toBe(true)

		clearSaveTimers(docId)
		expect(saveDebounceTimers.has(docId)).toBe(false)
		expect(saveMaxThrottleTimers.has(docId)).toBe(false)
	})

	it('enforces 10 MB maximum payload ceiling constant on incoming frames', () => {
		const { MAX_PAYLOAD_BYTES, wss } = require('../../server/index.js')
		expect(MAX_PAYLOAD_BYTES).toBe(10 * 1024 * 1024)
		expect(wss.options.maxPayload).toBe(10 * 1024 * 1024)
	})
})
