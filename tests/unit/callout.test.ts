import { describe, it, expect } from 'vitest'
import { parseMarkdown, serializeMarkdown } from '@/lib/markdown-io'
import { Callout, CALLOUT_TYPES } from '@/lib/callout'

/** Doc-level round-trip: parse → serialize → parse yields the same doc. */
function expectDocRoundTrip(md: string) {
	const first = parseMarkdown(md)
	const serialized = serializeMarkdown(first)
	const second = parseMarkdown(serialized)
	expect(second).toEqual(first)
}

describe('callout parse/serialize round-trip', () => {
	it('round-trips a simple callout with type and title', () => {
		const md = '> [!note] My title\n> Body line one\n'
		const doc = parseMarkdown(md)
		const callout = doc.content?.[0]
		expect(callout?.type).toBe('callout')
		expect(callout?.attrs).toMatchObject({ type: 'note', title: 'My title', collapsed: false })
		expectDocRoundTrip(md)
	})

	it('serializes an empty-title callout losslessly', () => {
		const md = '> [!tip]\n> just a body\n'
		expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
	})

	it('round-trips the collapsed flag both directions', () => {
		const md = '> [!warning]- Collapsed note\n> hidden body\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'warning', collapsed: true })
		expect(serializeMarkdown(doc)).toBe(md)
	})

	it('preserves unknown callout types verbatim', () => {
		const md = '> [!custom] My custom\n> body\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'custom', title: 'My custom' })
		expect(serializeMarkdown(doc)).toBe(md)
	})

	it('keeps inline marks inside the callout body', () => {
		const md = '> [!note] Title\n> **bold** and *italic* and `code`\n'
		expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
	})

	it('preserves a blank line between body paragraphs', () => {
		const md = '> [!note] T\n> p1\n>\n> p2\n'
		expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
	})

	it('round-trips a callout containing a list', () => {
		const md = '> [!note] T\n> - item one\n> - item two\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.content?.some((n) => n.type === 'bulletList')).toBe(true)
		expectDocRoundTrip(md)
	})

	it('round-trips a callout containing a code fence', () => {
		const md = '> [!tip] T\n> ```ts\n> const x = 1\n> ```\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.content?.some((n) => n.type === 'codeBlock')).toBe(true)
		expectDocRoundTrip(md)
	})

	it('leaves a plain blockquote untouched (regression)', () => {
		const md = '> A blockquote line\n>\n> Second paragraph\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.type).toBe('blockquote')
		expect(serializeMarkdown(doc)).toBe(md)
	})

	it('normalizes an uppercase marker to lowercase type', () => {
		const doc = parseMarkdown('> [!NOTE] Loud\n> body\n')
		expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'note' })
	})
})

describe('CALLOUT_TYPES', () => {
	it('defines the canonical known set', () => {
		expect(CALLOUT_TYPES).toEqual(['note', 'warning', 'info', 'tip', 'success', 'danger', 'question'])
	})
})
