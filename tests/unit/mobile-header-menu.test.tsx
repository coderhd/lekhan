import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MobileHeaderMenu from '../../components/mobile-header-menu'

const baseProps = {
	isHistoryOpen: false,
	setIsHistoryOpen: vi.fn(),
	isAIPanelOpen: false,
	setIsAIPanelOpen: vi.fn(),
	isBacklinksOpen: false,
	setIsBacklinksOpen: vi.fn(),
	theme: 'light' as const,
	toggleTheme: vi.fn(),
	activeUsers: [],
}

describe('MobileHeaderMenu sync status', () => {
	it('forwards pending local edits to the status chip', () => {
		render(
			<MobileHeaderMenu
				{...baseProps}
				connectionState="offline"
				isSynced={false}
				hasUnsyncedChanges={true}
			/>
		)

		fireEvent.click(screen.getByTitle('More options'))

		expect(screen.getByText('Local edits only')).toBeDefined()
	})

	it('shows "Offline" in the menu when there is nothing pending', () => {
		render(
			<MobileHeaderMenu
				{...baseProps}
				connectionState="offline"
				isSynced={false}
				hasUnsyncedChanges={false}
			/>
		)

		fireEvent.click(screen.getByTitle('More options'))

		expect(screen.getByText('Offline')).toBeDefined()
	})
})
