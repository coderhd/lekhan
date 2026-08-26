import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import * as analytics from '@/lib/analytics'
import PricingMatrix from '@/components/pricing-plans'
import { ImportReportCard } from '@/components/import-report-card'

vi.mock('@/lib/analytics', () => ({
	track: vi.fn(),
	initAnalytics: vi.fn(),
	identifyUser: vi.fn(),
	resetAnalytics: vi.fn(),
	isFeatureEnabled: vi.fn(),
}))

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}))

describe('Event Instrumentation', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('PricingMatrix', () => {
		it('emits upgrade_clicked when an upgrade button is clicked', () => {
			render(<PricingMatrix isLandingPage={true} />)
			const getProButton = screen.getByRole('button', { name: /Get Pro plan/i })
			fireEvent.click(getProButton)

			expect(analytics.track).toHaveBeenCalledWith('upgrade_clicked', {
				plan: 'pro',
				billing_cycle: 'yearly',
			})
		})
	})

	describe('ImportReportCard', () => {
		it('emits import_report_viewed with counts on render', () => {
			render(
				<ImportReportCard
					report={{
						pages: 5,
						folderPages: 2,
						linksResolved: 8,
						linksUnresolved: 1,
						degradedBlocks: 0,
					}}
					serverWarnings={[]}
					createdPages={[{ id: 'p1', title: 'Note 1' }]}
					onOpenPage={vi.fn()}
				/>
			)

			expect(analytics.track).toHaveBeenCalledWith('import_report_viewed', {
				pages: 5,
				folder_pages: 2,
				links_resolved: 8,
				links_unresolved: 1,
				degraded_blocks: 0,
				warnings_count: 0,
			})
		})
	})
})
