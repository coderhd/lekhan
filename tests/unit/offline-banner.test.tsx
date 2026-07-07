import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import OfflineBanner from '../../components/offline-banner'

describe('OfflineBanner', () => {
	it('renders the offline warning message', () => {
		render(<OfflineBanner />)
		expect(
			screen.getByText(/You're offline\. Changes are saved locally and will sync once you're back online\./)
		).toBeDefined()
	})
})
