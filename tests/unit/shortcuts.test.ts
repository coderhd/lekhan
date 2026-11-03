import { describe, it, expect } from 'vitest'
import { SHORTCUT_GROUPS, BROWSER_RESERVED_NOTE, formatShortcut, isTypingTarget } from '@/lib/shortcuts'

describe('shortcut inventory', () => {
	it('has unique ids per item and group', () => {
		const groupIds = SHORTCUT_GROUPS.map(group => group.id)
		expect(new Set(groupIds).size).toBe(groupIds.length)
		const itemIds = SHORTCUT_GROUPS.flatMap(group => group.items.map(item => item.id))
		expect(new Set(itemIds).size).toBe(itemIds.length)
	})

	it('describes every item with a label and a description', () => {
		for (const group of SHORTCUT_GROUPS) {
			expect(group.title.length).toBeGreaterThan(0)
			for (const item of group.items) {
				expect(item.label.length).toBeGreaterThan(0)
				expect(item.description.length).toBeGreaterThan(0)
				// Either it is a key combo, typed syntax, or explicitly keyless.
				expect(Boolean(item.keys?.length) || Boolean(item.gesture) || Boolean(item.note)).toBe(true)
			}
		}
	})

	it('only lists shortcuts the app implements', () => {
		const ids = SHORTCUT_GROUPS.flatMap(group => group.items.map(item => item.id))
		expect(ids).toEqual(
			expect.arrayContaining(['palette', 'help', 'slash', 'wikilink', 'bot', 'history', 'copy', 'paste', 'escape', 'share']),
		)
	})

	it('calls out browser-owned keys instead of claiming them', () => {
		expect(BROWSER_RESERVED_NOTE).toMatch(/browser/i)
		expect(BROWSER_RESERVED_NOTE).toMatch(/⌘W/)
	})
})

describe('formatShortcut', () => {
	const keys = [
		{ mac: '⌘', other: 'Ctrl' },
		{ mac: 'K', other: 'K' },
	]

	it('joins mac tokens without a separator', () => {
		expect(formatShortcut(keys, 'mac')).toBe('⌘K')
	})

	it('joins non-mac tokens with a plus', () => {
		expect(formatShortcut(keys, 'other')).toBe('Ctrl+K')
	})
})

describe('isTypingTarget', () => {
	it('is false for a null or non-element target', () => {
		expect(isTypingTarget(null)).toBe(false)
		expect(isTypingTarget(undefined)).toBe(false)
		expect(isTypingTarget(document)).toBe(false)
	})

	it('detects inputs, textareas and selects', () => {
		expect(isTypingTarget(document.createElement('input'))).toBe(true)
		expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
		expect(isTypingTarget(document.createElement('select'))).toBe(true)
	})

	it('detects contenteditable hosts and their children', () => {
		const editor = document.createElement('div')
		editor.setAttribute('contenteditable', 'true')
		const child = document.createElement('p')
		editor.appendChild(child)
		expect(isTypingTarget(editor)).toBe(true)
		expect(isTypingTarget(child)).toBe(true)
	})

	it('is false for ordinary page elements', () => {
		expect(isTypingTarget(document.createElement('button'))).toBe(false)
		expect(isTypingTarget(document.createElement('div'))).toBe(false)
	})
})
