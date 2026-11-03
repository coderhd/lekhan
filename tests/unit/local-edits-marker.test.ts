import { describe, it, expect, beforeEach } from 'vitest'
import {
	hasPendingLocalEdits,
	setPendingLocalEdits,
} from '../../lib/local-edits-marker'

describe('local edits marker', () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	it('reports no pending edits for a clean document', () => {
		expect(hasPendingLocalEdits('doc-1')).toBe(false)
	})

	it('remembers pending edits per document across reloads', () => {
		setPendingLocalEdits('doc-1', true)
		expect(hasPendingLocalEdits('doc-1')).toBe(true)
		expect(hasPendingLocalEdits('doc-2')).toBe(false)
	})

	it('clears the marker once edits reach the hub', () => {
		setPendingLocalEdits('doc-1', true)
		setPendingLocalEdits('doc-1', false)
		expect(hasPendingLocalEdits('doc-1')).toBe(false)
	})

	it('does not throw when storage is unavailable', () => {
		const original = window.localStorage
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			value: {
				getItem: () => { throw new Error('denied') },
				setItem: () => { throw new Error('denied') },
				removeItem: () => { throw new Error('denied') },
			},
		})

		expect(() => setPendingLocalEdits('doc-1', true)).not.toThrow()
		expect(hasPendingLocalEdits('doc-1')).toBe(false)

		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			value: original,
		})
	})
})
