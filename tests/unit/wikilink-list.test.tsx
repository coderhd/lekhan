import { describe, it, expect, vi } from 'vitest'
import { createRef, forwardRef, act, type ComponentProps } from 'react'
import { render, fireEvent, screen } from '@testing-library/react'
import WikilinkList, { type WikilinkListRef } from '@/components/wikilink-list'
import type { WikilinkSuggestionItem } from '@/lib/wikilink'

function hostProps(items: WikilinkSuggestionItem[], onCommand: (item: WikilinkSuggestionItem) => void) {
	return { items, command: onCommand } as ComponentProps<typeof WikilinkList>
}

const keydown = (key: string) => ({ event: new KeyboardEvent('keydown', { key }) } as any)

describe('WikilinkList keyboard navigation (clean-room review round 2)', () => {
	it('Enter commits the selected page item through the ref API (criterion 2/6)', () => {
		const items: WikilinkSuggestionItem[] = [
			{ id: 'p1', title: 'Alpha', kind: 'page' },
			{ id: 'p2', title: 'Beta', kind: 'page' },
		]
		const command = vi.fn()
		const ref = createRef<WikilinkListRef>()

		const Host = forwardRef<WikilinkListRef, ComponentProps<typeof WikilinkList>>((props, fwd) => (
			<WikilinkList {...props} ref={fwd} />
		))

		render(<Host {...hostProps(items, command)} ref={ref} />)

		act(() => {
			const handled = ref.current?.onKeyDown(keydown('Enter'))
			expect(handled).toBe(true)
		})
		expect(command).toHaveBeenCalledWith(items[0])

		// ArrowDown moves selection to Beta; Enter then commits Beta.
		act(() => {
			expect(ref.current?.onKeyDown(keydown('ArrowDown'))).toBe(true)
		})
		act(() => {
			ref.current?.onKeyDown(keydown('Enter'))
		})
		expect(command).toHaveBeenLastCalledWith(items[1])
	})

	it('Tab commits too, and Escape is left to the Suggestion plugin (returns false)', () => {
		const items: WikilinkSuggestionItem[] = [{ id: 'p1', title: 'Alpha', kind: 'page' }]
		const command = vi.fn()
		const ref = createRef<WikilinkListRef>()

		const Host = forwardRef<WikilinkListRef, ComponentProps<typeof WikilinkList>>((props, fwd) => (
			<WikilinkList {...props} ref={fwd} />
		))

		render(<Host {...hostProps(items, command)} ref={ref} />)

		act(() => {
			expect(ref.current?.onKeyDown(keydown('Tab'))).toBe(true)
		})
		expect(command).toHaveBeenCalledWith(items[0])

		act(() => {
			expect(ref.current?.onKeyDown(keydown('Escape'))).toBe(false)
		})
	})

	it('hint rows are visible but never commit', () => {
		const items: WikilinkSuggestionItem[] = [{ id: '__wikilink_hint__', title: '', kind: 'hint' }]
		const command = vi.fn()
		const ref = createRef<WikilinkListRef>()

		const Host = forwardRef<WikilinkListRef, ComponentProps<typeof WikilinkList>>((props, fwd) => (
			<WikilinkList {...props} ref={fwd} />
		))

		render(<Host {...hostProps(items, command)} ref={ref} />)
		expect(screen.getByText('Type a name to create a page')).toBeDefined()

		act(() => {
			const handled = ref.current?.onKeyDown(keydown('Enter'))
			expect(handled).toBe(true)
		})
		expect(command).not.toHaveBeenCalled()
	})

	it('arrow navigation skips hint rows (a11y: hints are not selectable options)', () => {
		const items: WikilinkSuggestionItem[] = [
			{ id: 'p1', title: 'Alpha', kind: 'page' },
			{ id: '__wikilink_hint__', title: '', kind: 'hint' },
			{ id: 'p2', title: 'Beta', kind: 'page' },
		]
		const command = vi.fn()
		const ref = createRef<WikilinkListRef>()

		const Host = forwardRef<WikilinkListRef, ComponentProps<typeof WikilinkList>>((props, fwd) => (
			<WikilinkList {...props} ref={fwd} />
		))

		render(<Host {...hostProps(items, command)} ref={ref} />)

		act(() => {
			ref.current?.onKeyDown(keydown('ArrowDown'))
		})
		act(() => {
			ref.current?.onKeyDown(keydown('Enter'))
		})
		// Landed on Beta (index 2), not on the hint row.
		expect(command).toHaveBeenLastCalledWith(items[2])
	})

	it('listbox semantics: header outside listbox, options carry aria-selected, hint hidden (a11y)', () => {
		const items: WikilinkSuggestionItem[] = [
			{ id: 'p1', title: 'Alpha', kind: 'page' },
			{ id: 'p2', title: 'Beta', kind: 'page' },
		]
		const command = vi.fn()

		render(<WikilinkList items={items} command={command} />)

		const listbox = screen.getByRole('listbox')
		const options = screen.getAllByRole('option')
		expect(options).toHaveLength(2)
		expect(options[0].getAttribute('aria-selected')).toBe('true')
		expect(options[1].getAttribute('aria-selected')).toBe('false')
		expect(listbox.getAttribute('aria-label')).toBe('Page suggestions')
		// The "Pages" header must not be a child of the listbox.
		expect(listbox.textContent).not.toContain('Pages')

		fireEvent.click(screen.getAllByTestId('wikilink-page-item')[0])
		expect(command).toHaveBeenCalledWith(items[0])
	})

	it('hint row is hidden from assistive tech while shown visually', () => {
		const items: WikilinkSuggestionItem[] = [{ id: '__wikilink_hint__', title: '', kind: 'hint' }]
		const command = vi.fn()

		render(<WikilinkList items={items} command={command} />)

		const hint = screen.getByText('Type a name to create a page').closest('[data-hint-row]')
		expect(hint?.getAttribute('aria-hidden')).toBe('true')
		expect(screen.queryAllByRole('option')).toHaveLength(0)
	})
})
