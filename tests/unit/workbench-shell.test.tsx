import '@testing-library/jest-dom'
import React from 'react'
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WorkbenchShell from '@/components/workbench/workbench-shell'
import { GlobalHeaderProvider } from '@/components/layout/global-header-context'

const shell = (
	children = <input aria-label="Draft" defaultValue="Keep this thought" />
) => (
	<GlobalHeaderProvider>
		<WorkbenchShell
			active="workspace"
			workspaceName="My writing"
			pages={[{ id: 'real-page', title: 'A real page' }]}
			onSearch={vi.fn()}
		>
			{children}
		</WorkbenchShell>
	</GlobalHeaderProvider>
)

describe('Workbench shell', () => {
	it('keeps real routes and current destination keyboard reachable', () => {
		render(shell())
		const nav = screen.getByRole('navigation', { name: 'Main navigation' })
		expect(
			within(nav).getByRole('link', { name: /workspace/i })
		).toHaveAttribute('aria-current', 'page')
		expect(within(nav).getByRole('link', { name: /graph/i })).toHaveAttribute(
			'href',
			'/graph'
		)
		expect(screen.getByRole('link', { name: 'A real page' })).toHaveAttribute(
			'href',
			'/page/real-page'
		)
	})

	it('names mobile navigation, closes with Escape and preserves the editing subtree', async () => {
		render(shell())
		const trigger = screen.getByRole('button', {
			name: 'Open workspace navigation'
		})
		trigger.focus()
		fireEvent.click(trigger)
		expect(
			screen.getByRole('dialog', { name: 'Workspace navigation' })
		).toBeInTheDocument()
		fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
		await act(async () => {})
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		await waitFor(() => expect(trigger).toHaveFocus())
		expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue(
			'Keep this thought'
		)
	})

	it('runs caller actions and closes mobile navigation after choosing search', async () => {
		const onSearch = vi.fn()
		render(
			<GlobalHeaderProvider>
				<WorkbenchShell active="graph" workspaceName="Work" onSearch={onSearch}>
					Graph
				</WorkbenchShell>
			</GlobalHeaderProvider>
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Open workspace navigation' })
		)
		fireEvent.click(
			within(screen.getByRole('dialog')).getByRole('button', {
				name: /search/i
			})
		)
		await waitFor(() => expect(onSearch).toHaveBeenCalledOnce())
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
	})
})
