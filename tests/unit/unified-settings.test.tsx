import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { UnifiedSettingsModal } from '../../components/settings/unified-settings-modal'

describe('UnifiedSettingsModal UI', () => {
	it('renders tabs and switches content', () => {
		render(<UnifiedSettingsModal isOpen={true} onClose={vi.fn()} />)
		
		const aiTab = screen.getByRole('tab', { name: /ai & models/i })
		const generalTab = screen.getByRole('tab', { name: /general & profile/i })
		
		expect(aiTab).toBeInTheDocument()
		expect(generalTab).toBeInTheDocument()
		
		// Click General tab
		fireEvent.click(generalTab)
		expect(screen.getByText(/general settings/i)).toBeInTheDocument()
		
		// Click AI tab
		fireEvent.click(aiTab)
		// Should render AIProviderSettings, which has Tier 1 text
		expect(screen.getByText(/Tier 1: Local Offline Hub/i)).toBeInTheDocument()
	})
})
