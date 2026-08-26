import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import * as analytics from '@/lib/analytics'
import PricingMatrix from '@/components/pricing-plans'
import { ImportReportCard } from '@/components/import-report-card'
import ShareModal from '@/components/share-modal'
import { CollaboratorLimitError } from '@/services/graph'

vi.mock('@/services/graph', () => ({
	fetchPageDetails: vi.fn().mockResolvedValue({ is_public: false }),
	fetchPastCollaborators: vi.fn().mockResolvedValue([]),
	fetchPageMembers: vi.fn().mockResolvedValue([]),
	createPageInvitation: vi.fn(),
	CollaboratorLimitError: class CollaboratorLimitError extends Error {
		readonly code = 'COLLABORATOR_LIMIT_REACHED'
		constructor(message: string) {
			super(message)
			this.name = 'CollaboratorLimitError'
		}
	},
}))

vi.mock('@/services/db', () => ({
	fetchPastCollaborators: vi.fn().mockResolvedValue([]),
}))

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

		it('omits billing_cycle for enterprise plan in upgrade_clicked event', () => {
			render(<PricingMatrix isLandingPage={true} />)
			const teamTab = screen.getByRole('button', { name: /^Team and Enterprise$/i })
			fireEvent.click(teamTab)

			const contactButton = screen.getByRole('button', { name: /Contact Sales/i })
			fireEvent.click(contactButton)

			expect(analytics.track).toHaveBeenCalledWith('upgrade_clicked', {
				plan: 'enterprise',
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

	describe('ShareModal', () => {
		it('emits paywall_hit when invitation fails with CollaboratorLimitError', async () => {
			const { createPageInvitation } = await import('@/services/graph')
			vi.mocked(createPageInvitation).mockRejectedValueOnce(
				new CollaboratorLimitError('Collaborator limit reached (max 2).')
			)

			render(
				<ShareModal
					isOpen={true}
					onClose={vi.fn()}
					documentId="doc-1"
					documentTitle="Test Document"
					userId="user-1"
					isOwner={true}
				/>
			)

			const input = screen.getByPlaceholderText(/collaborator@example\.com/i)
			fireEvent.change(input, { target: { value: 'collab@example.com' } })

			const form = input.closest('form')!
			fireEvent.submit(form)

			await vi.waitFor(() => {
				expect(analytics.track).toHaveBeenCalledWith('paywall_hit', {
					gate: 'collaborators',
				})
			})
		})
	})
})
