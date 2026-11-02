import '@testing-library/jest-dom'
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import GraphFilters from '@/components/graph-filters'
import { EMPTY_GRAPH_FILTER, type GraphFilterState } from '@/lib/graph-view/filters'
import type { GraphTagFacet } from '@/lib/graph-view/types'

const facets: GraphTagFacet[] = [
	{ tag: 'research', count: 3 },
	{ tag: 'journal', count: 1 },
]

const active: GraphFilterState = { title: 'alp', tags: ['research'] }

describe('GraphFilters', () => {
	it('exposes a labelled title search input', () => {
		render(<GraphFilters state={EMPTY_GRAPH_FILTER} facets={facets} visiblePages={4} totalPages={4} dispatch={vi.fn()} />)

		const input = screen.getByRole('searchbox', { name: /filter pages by title/i })
		expect(input).toHaveValue('')
		expect(input).toHaveClass('min-h-11')
	})

	it('dispatches the typed title', () => {
		const dispatch = vi.fn()
		render(<GraphFilters state={EMPTY_GRAPH_FILTER} facets={facets} visiblePages={4} totalPages={4} dispatch={dispatch} />)

		fireEvent.change(screen.getByRole('searchbox', { name: /filter pages by title/i }), { target: { value: 'alp' } })

		expect(dispatch).toHaveBeenCalledWith({ type: 'set-title', title: 'alp' })
	})

	it('renders tag facets as native, labelled, keyboard-focusable checkbox chips', () => {
		render(<GraphFilters state={EMPTY_GRAPH_FILTER} facets={facets} visiblePages={4} totalPages={4} dispatch={vi.fn()} />)

		const research = screen.getByRole('checkbox', { name: /#research/i })
		expect(research).not.toBeChecked()
		const chip = research.closest('label')
		expect(chip).not.toBeNull()
		expect(screen.getByRole('group', { name: /filter by tag/i })).toBeInTheDocument()

		research.focus()
		expect(research).toHaveFocus()
		expect(chip?.className).toContain('focus-within:ring-2')
	})

	it('reports the checked facet state and dispatches toggles', () => {
		const dispatch = vi.fn()
		render(<GraphFilters state={active} facets={facets} visiblePages={1} totalPages={4} dispatch={dispatch} />)

		const research = screen.getByRole('checkbox', { name: /#research/i })
		expect(research).toBeChecked()
		expect(screen.getByRole('checkbox', { name: /#journal/i })).not.toBeChecked()

		fireEvent.click(screen.getByRole('checkbox', { name: /#journal/i }))
		expect(dispatch).toHaveBeenCalledWith({ type: 'toggle-tag', tag: 'journal' })
	})

	it('announces the filtered result count politely', () => {
		render(<GraphFilters state={active} facets={facets} visiblePages={1} totalPages={4} dispatch={vi.fn()} />)

		const status = screen.getByRole('status')
		expect(status).toHaveAttribute('aria-live', 'polite')
		expect(status).toHaveTextContent('1 of 4 pages')
	})

	it('offers a 44 px clear control only while a filter is active', () => {
		const dispatch = vi.fn()
		const { rerender } = render(
			<GraphFilters state={EMPTY_GRAPH_FILTER} facets={facets} visiblePages={4} totalPages={4} dispatch={dispatch} />,
		)

		expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()

		rerender(<GraphFilters state={active} facets={facets} visiblePages={1} totalPages={4} dispatch={dispatch} />)
		const clear = screen.getByRole('button', { name: /clear filters/i })
		expect(clear).toHaveClass('min-h-11')

		fireEvent.click(clear)
		expect(dispatch).toHaveBeenCalledWith({ type: 'clear' })
		// The button unmounts on clear; focus must not fall back to <body>.
		expect(screen.getByRole('searchbox', { name: /filter pages by title/i })).toHaveFocus()
	})

	it('omits the facet group when the workspace has no tags', () => {
		render(<GraphFilters state={EMPTY_GRAPH_FILTER} facets={[]} visiblePages={2} totalPages={2} dispatch={vi.fn()} />)

		expect(screen.queryByRole('group', { name: /filter by tag/i })).not.toBeInTheDocument()
	})
})
