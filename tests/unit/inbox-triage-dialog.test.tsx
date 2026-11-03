import '@testing-library/jest-dom'
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InboxTriageDialog from '@/components/inbox-triage-dialog'
import type { SearchResult } from '@/types'

// `services/search` (the default search prop) creates a Supabase client at
// module load; CI has no NEXT_PUBLIC_SUPABASE_* env, so stub the client.
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))

const results: SearchResult[] = [
	{ id: 'p-1', title: 'Project Alpha', icon: 'description', workspace_id: 'ws-1', updated_at: '', surface: 'title', context: null },
	{ id: 'p-2', title: 'Alice Chen', icon: null, workspace_id: 'ws-1', updated_at: '', surface: 'title', context: null },
]

const search = vi.fn()

const renderDialog = (props: Partial<React.ComponentProps<typeof InboxTriageDialog>> = {}) =>
	render(
		<InboxTriageDialog
			mode="link"
			rowText="10:15 Call Alice #inbox"
			onOpenChange={vi.fn()}
			onSelectPage={vi.fn()}
			onTag={vi.fn()}
			search={search}
			{...props}
		/>,
	)

describe('InboxTriageDialog', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		search.mockResolvedValue(results)
	})

	it('links the focused row to a chosen page', async () => {
		const onSelectPage = vi.fn()
		renderDialog({ onSelectPage })

		expect(await screen.findByRole('dialog', { name: /link .* to a page/i })).toBeInTheDocument()
		expect(screen.getByText(/Call Alice #inbox/)).toBeInTheDocument()

		fireEvent.click(await screen.findByRole('button', { name: /Project Alpha/i }))

		expect(onSelectPage).toHaveBeenCalledWith(results[0])
	})

	it('searches pages as the query changes', async () => {
		renderDialog()

		const input = await screen.findByLabelText(/find a page/i)
		fireEvent.change(input, { target: { value: 'alice' } })

		await waitFor(() => expect(search).toHaveBeenLastCalledWith('alice'))
	})

	it('shows the empty state when no page matches', async () => {
		search.mockResolvedValue([])
		renderDialog()

		fireEvent.change(await screen.findByLabelText(/find a page/i), { target: { value: 'zzz' } })

		expect(await screen.findByText(/no pages match/i)).toBeInTheDocument()
	})

	it('surfaces a search failure without hiding the input', async () => {
		search.mockRejectedValue(new Error('offline'))
		renderDialog()

		expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't search pages/i)
		expect(screen.getByLabelText(/find a page/i)).toBeInTheDocument()
	})

	it('adds a tag to the row', async () => {
		const onTag = vi.fn()
		renderDialog({ mode: 'tag', onTag })

		expect(await screen.findByRole('dialog', { name: /add a tag/i })).toBeInTheDocument()
		fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'launch' } })
		fireEvent.click(screen.getByRole('button', { name: /add tag/i }))

		expect(onTag).toHaveBeenCalledWith('launch')
	})

	it('disables adding an empty tag', async () => {
		renderDialog({ mode: 'tag' })

		expect(await screen.findByRole('button', { name: /add tag/i })).toBeDisabled()
	})

	it('validates the tag grammar before submitting', async () => {
		renderDialog({ mode: 'tag' })

		const input = await screen.findByLabelText('Tag')
		fireEvent.change(input, { target: { value: 'two words' } })

		expect(screen.getByRole('button', { name: /add tag/i })).toBeDisabled()
		expect(input).toHaveAttribute('aria-invalid', 'true')
		expect(screen.getByText(/use one tag/i)).toBeInTheDocument()
	})

	it('ignores Enter for an invalid tag', async () => {
		const onTag = vi.fn()
		renderDialog({ mode: 'tag', onTag })

		const input = await screen.findByLabelText('Tag')
		fireEvent.change(input, { target: { value: 'two words' } })
		fireEvent.keyDown(input, { key: 'Enter' })

		expect(onTag).not.toHaveBeenCalled()
	})

	it('disables the picker while a link is being saved', async () => {
		renderDialog({ busy: true })

		expect(await screen.findByText(/linking/i)).toBeInTheDocument()
		expect(await screen.findByRole('button', { name: /Project Alpha/i })).toBeDisabled()
	})
})
