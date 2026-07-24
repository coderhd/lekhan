import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import MentionList from '@/components/mention-list'
import React from 'react'


describe('MentionList', () => {
	const items = [
		{ id: '1', name: 'Alice Smith', email: 'alice@example.com' },
		{ id: '2', name: 'Bob Jones', email: 'bob@example.com' },
	]

	it('renders list of mention items', () => {
		render(<MentionList items={items} command={vi.fn()} />)
		expect(screen.getByText('Alice Smith')).toBeInTheDocument()
		expect(screen.getByText('Bob Jones')).toBeInTheDocument()
	})

	it('calls command on item click', () => {
		const commandMock = vi.fn()
		render(<MentionList items={items} command={commandMock} />)
		fireEvent.click(screen.getByText('Alice Smith'))
		expect(commandMock).toHaveBeenCalledWith({ id: '1', label: 'Alice Smith' })
	})
})
