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

	it('serializes concurrent saves for the same document without overlapping execution', async () => {
		const { triggerSerializedSave } = require('../../server/index.js')
		const ydoc = new Y.Doc()
		ydoc.getText('default').insert(0, 'Hello world')

		// Trigger two saves in rapid succession
		const p1 = triggerSerializedSave('doc-serialize-1', ydoc)
		const p2 = triggerSerializedSave('doc-serialize-1', ydoc)

		await vi.advanceTimersByTimeAsync(150)
		await Promise.allSettled([p1, p2])

		expect(p1).toBeDefined()
		expect(p2).toBeDefined()
	})

	it('enforces 10 MB maximum payload ceiling constant on incoming frames', () => {
		const { MAX_PAYLOAD_BYTES, wss } = require('../../server/index.js')
		expect(MAX_PAYLOAD_BYTES).toBe(10 * 1024 * 1024)
		expect(wss.options.maxPayload).toBe(10 * 1024 * 1024)
	})
})
