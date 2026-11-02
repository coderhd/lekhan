import '@testing-library/jest-dom'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import WorkspaceViewsNav from '@/components/workspace-views-nav'

describe('WorkspaceViewsNav', () => {
	it('renders keyboard-reachable Pages and Graph links', () => {
		render(<WorkspaceViewsNav active="pages" />)

		const nav = screen.getByRole('navigation', { name: /workspace views/i })
		const pages = screen.getByRole('link', { name: /pages/i })
		const graph = screen.getByRole('link', { name: /graph/i })

		expect(nav).toContainElement(pages)
		expect(nav).toContainElement(graph)
		expect(pages).toHaveAttribute('href', '/')
		expect(graph).toHaveAttribute('href', '/graph')
		// Anchors are natively tabbable — the tab is keyboard reachable.
		expect(graph.tabIndex).toBe(0)
	})

	it('marks the active view with aria-current', () => {
		const { rerender } = render(<WorkspaceViewsNav active="pages" />)
		expect(screen.getByRole('link', { name: /pages/i })).toHaveAttribute('aria-current', 'page')
		expect(screen.getByRole('link', { name: /graph/i })).not.toHaveAttribute('aria-current')

		rerender(<WorkspaceViewsNav active="graph" />)
		expect(screen.getByRole('link', { name: /graph/i })).toHaveAttribute('aria-current', 'page')
		expect(screen.getByRole('link', { name: /pages/i })).not.toHaveAttribute('aria-current')
	})
})
