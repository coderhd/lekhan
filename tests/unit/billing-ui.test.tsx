import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import BillingSettings from '@/components/billing/billing-settings'
import type { WorkspaceEntitlement } from '@/lib/billing/entitlements'
import type { ReferralSummary } from '@/services/billing/referral-credits'

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/supabase', () => ({
	supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}))

vi.mock('@/lib/analytics', () => ({
	track: vi.fn(),
}))

vi.mock('sonner', () => ({
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

function entitlement(overrides: Partial<WorkspaceEntitlement> = {}): WorkspaceEntitlement {
	return {
		workspaceId: 'ws-1',
		tier: 'pro',
		billingCycle: 'annual',
		status: 'active',
		gateway: 'stripe',
		currentPeriodEnd: '2026-12-01T00:00:00.000Z',
		cancelAtPeriodEnd: false,
		pastDueSince: null,
		isFounding: true,
		seats: null,
		graceExpiresAt: null,
		inGracePeriod: false,
		relayReadOnly: false,
		...overrides,
	}
}

const referral: ReferralSummary = {
	workspaceId: 'ws-1',
	creditedMonths: 3,
	bankedMonths: 2,
	appliedMonths: 1,
	lifetimeGrantedMonths: 3,
	activationGrants: 2,
	conversionGrants: 1,
	bankCapMonths: 12,
	capReached: false,
	rows: [],
}

const handlers = {
	onManageBilling: vi.fn(),
	onCancel: vi.fn(),
	onResubscribe: vi.fn(),
	onRefresh: vi.fn(),
}

describe('BillingSettings (T12 real states)', () => {
	it('renders the live plan, cycle, period end and founding badge from entitlement', () => {
		render(<BillingSettings entitlement={entitlement()} referral={referral} {...handlers} />)

		expect(screen.getAllByText('Pro').length).toBeGreaterThan(0)
		expect(screen.getByText('annual')).toBeInTheDocument()
		expect(screen.getAllByText('Founding price').length).toBeGreaterThan(0)
		expect(screen.getByText(/Workspace billing is active/i)).toBeInTheDocument()
	})

	it('states cancellation with the provider period end (US-6 AC1)', () => {
		render(
			<BillingSettings
				entitlement={entitlement({ cancelAtPeriodEnd: true })}
				referral={null}
				{...handlers}
			/>,
		)
		expect(screen.getByText(/Cancels on/i)).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Resubscribe/i })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Cancel at period end/i })).not.toBeInTheDocument()
	})

	it('shows the 7-day grace banner with the real grace window (US-7)', () => {
		render(
			<BillingSettings
				entitlement={entitlement({
					status: 'past_due',
					pastDueSince: '2026-10-20T00:00:00.000Z',
					graceExpiresAt: '2026-10-27T00:00:00.000Z',
					inGracePeriod: true,
				})}
				referral={null}
				{...handlers}
			/>,
		)
		expect(screen.getByText(/Payment failed/i)).toBeInTheDocument()
		expect(screen.getByText(/your notes are never deleted/i)).toBeInTheDocument()
	})

	it('shows the read-only state after grace expiry without deleting anything', () => {
		render(
			<BillingSettings
				entitlement={entitlement({ status: 'past_due', inGracePeriod: false, relayReadOnly: true })}
				referral={null}
				{...handlers}
			/>,
		)
		expect(screen.getByText(/Sync is read-only/i)).toBeInTheDocument()
		expect(screen.getByText(/nothing has been deleted/i)).toBeInTheDocument()
	})

	it('surfaces referral months (US-10/US-11)', () => {
		render(<BillingSettings entitlement={entitlement()} referral={referral} {...handlers} />)
		expect(screen.getByTestId('referral-summary')).toHaveTextContent('2 banked months ready to apply')
		expect(screen.getByTestId('referral-summary')).toHaveTextContent('1 already applied')
	})

	it('does not offer Resubscribe for a terminal free row (no paid tier to resubscribe to)', () => {
		render(
			<BillingSettings
				entitlement={entitlement({ tier: 'free', status: 'canceled', cancelAtPeriodEnd: false })}
				referral={null}
				{...handlers}
			/>,
		)
		expect(screen.queryByRole('button', { name: /Resubscribe/i })).not.toBeInTheDocument()
	})

	it('uses buttons for every billing action (house React rule)', () => {
		render(<BillingSettings entitlement={entitlement()} referral={referral} {...handlers} />)
		for (const name of [/Manage billing/i, /Cancel at period end/i, /Refresh/i]) {
			const button = screen.getByRole('button', { name })
			expect(button.tagName).toBe('BUTTON')
			expect(button).toHaveAttribute('type', 'button')
		}
	})

	it('fires the wired actions', () => {
		render(<BillingSettings entitlement={entitlement()} referral={null} {...handlers} />)
		fireEvent.click(screen.getByRole('button', { name: /Manage billing/i }))
		expect(handlers.onManageBilling).toHaveBeenCalled()
		fireEvent.click(screen.getByRole('button', { name: /Cancel at period end/i }))
		expect(handlers.onCancel).toHaveBeenCalled()
		fireEvent.click(screen.getByRole('button', { name: /Refresh/i }))
		expect(handlers.onRefresh).toHaveBeenCalled()
	})

	it('keeps the US-2 AC1 USD escape hatch reachable from the billing tab', () => {
		render(<BillingSettings entitlement={entitlement({ tier: 'free', gateway: 'none' })} referral={null} {...handlers} />)
		fireEvent.click(screen.getByRole('button', { name: /₹ INR/i }))
		fireEvent.click(screen.getByRole('button', { name: /^Team and Enterprise$/i }))
		expect(screen.getByRole('button', { name: /Pay internationally in USD/i })).toBeInTheDocument()
	})

	it('has no surviving credit counter or credit ledger reader anywhere in components/', () => {
		const banned = [
			/Credits left/i,
			/AI Credits/i,
			/getUserAICredits/,
			/getPlanMaxDocuments/,
			/deductUserAICredits/,
			/used_credits/,
			/totalAllocated/,
			/remainingCredits/,
			/Credit Consumption/i,
		]
		const root = path.resolve(__dirname, '../../components')
		const files: string[] = []
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name)
				if (entry.isDirectory()) walk(full)
				else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
			}
		}
		walk(root)

		const offenders: string[] = []
		for (const file of files) {
			const source = fs.readFileSync(file, 'utf8')
			for (const pattern of banned) {
				if (pattern.test(source)) offenders.push(`${path.relative(root, file)} matched ${pattern}`)
			}
		}
		expect(offenders).toEqual([])
	})
})
