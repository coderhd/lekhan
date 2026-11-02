import { describe, it, expect } from 'vitest'

const { isBlockedWriteFrame, SYNC_STEP1, SYNC_STEP2, SYNC_UPDATE } = require('../../server/connection-guard.js')

function frame(syncType: number): Buffer {
	return Buffer.from([0, syncType, 0, 0])
}

describe('read-only collab frame guard (SIL-214)', () => {
	it('blocks sync step 2 and update frames from read-only connections', () => {
		expect(isBlockedWriteFrame({ isReadOnly: true }, frame(SYNC_STEP2), true)).toBe(true)
		expect(isBlockedWriteFrame({ isReadOnly: true }, frame(SYNC_UPDATE), true)).toBe(true)
	})

	it('allows sync step 1 so the server still answers with its state', () => {
		expect(isBlockedWriteFrame({ isReadOnly: true }, frame(SYNC_STEP1), true)).toBe(false)
	})

	it('applies the same rule to viewers', () => {
		expect(isBlockedWriteFrame({ isViewer: true }, frame(SYNC_STEP2), true)).toBe(true)
		expect(isBlockedWriteFrame({ isViewer: true }, frame(SYNC_UPDATE), true)).toBe(true)
	})

	it('does not block writable connections', () => {
		expect(isBlockedWriteFrame({}, frame(SYNC_STEP2), true)).toBe(false)
		expect(isBlockedWriteFrame({ isViewer: false, isReadOnly: false }, frame(SYNC_UPDATE), true)).toBe(false)
	})

	it('ignores non-binary, empty, and non-sync frames', () => {
		expect(isBlockedWriteFrame({ isReadOnly: true }, frame(SYNC_UPDATE), false)).toBe(false)
		expect(isBlockedWriteFrame({ isReadOnly: true }, Buffer.alloc(0), true)).toBe(false)
		expect(isBlockedWriteFrame({ isReadOnly: true }, Buffer.from([1, SYNC_UPDATE]), true)).toBe(false)
		expect(isBlockedWriteFrame({ isReadOnly: true }, null, true)).toBe(false)
	})
})
