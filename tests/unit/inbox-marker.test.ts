import { describe, expect, it } from 'vitest'
import { hasInboxMarker, stripInboxMarker } from '@/lib/inbox-marker'

describe('inbox marker matcher', () => {
	it('matches the standalone marker at a boundary or after punctuation', () => {
		expect(hasInboxMarker('#inbox')).toBe(true)
		expect(hasInboxMarker('09:41 Buy milk #inbox')).toBe(true)
		expect(hasInboxMarker('09:41 Buy milk #Inbox.')).toBe(true)
		expect(hasInboxMarker('(#inbox)')).toBe(true)
		expect(hasInboxMarker('#inbox*')).toBe(true)
	})

	it('rejects longer tag names that merely start with #inbox', () => {
		expect(hasInboxMarker('#inboxing')).toBe(false)
		expect(hasInboxMarker('#inbox_notes')).toBe(false)
		expect(hasInboxMarker('#inbox-2026')).toBe(false)
		expect(hasInboxMarker('#inbox/foo')).toBe(false)
	})

	it('strips only the standalone marker', () => {
		expect(stripInboxMarker('09:41 Buy milk #inbox')).toBe('09:41 Buy milk')
		expect(stripInboxMarker('09:41 #Inbox Buy milk')).toBe('09:41 Buy milk')
		expect(stripInboxMarker('09:41 #inbox-2026 task')).toBe('09:41 #inbox-2026 task')
		expect(stripInboxMarker('09:41 #inbox/foo task')).toBe('09:41 #inbox/foo task')
	})

	it('removes a parenthesized marker without leaving an empty pair', () => {
		expect(stripInboxMarker('(#inbox) buy stamps')).toBe('buy stamps')
		expect(stripInboxMarker('09:41 ( #inbox ) buy stamps')).toBe('09:41 buy stamps')
	})
})
