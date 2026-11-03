import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import SettingsClient from '@/components/settings-client'
import { GlobalHeaderProvider } from '@/components/layout/global-header-context'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
	toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
			getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null }),
			onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
		},
	},
}))

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
	usePathname: () => '/settings',
}))

function renderSettings(uri = '/settings') {
	if (typeof window !== 'undefined') window.history.replaceState(null, '', uri)
	return render(
		<GlobalHeaderProvider>
			<SettingsClient user={{ id: 'u1', email: 'test@example.com' }} token="mock" />
		</GlobalHeaderProvider>
	)
}

describe('SIL-232 settings audit extension — tablist keyboard contract', () => {
	it('keeps one tab stop: unselected tabs are out of the tab order', () => {
		renderSettings()
		const active = screen.getByRole('tab', { name: /Profile & Security/i })
		const other = screen.getByRole('tab', { name: /AI & Models/i })
		expect(active).toHaveAttribute('tabindex', '0')
		expect(other).toHaveAttribute('tabindex', '-1')
	})

	it('arrow keys move focus and selection together', () => {
		renderSettings()
		const profile = screen.getByRole('tab', { name: /Profile & Security/i })
		profile.focus()
		fireEvent.keyDown(profile, { key: 'ArrowRight' })
		const collaborators = screen.getByRole('tab', { name: /Collaborators & Access/i })
		expect(collaborators).toHaveAttribute('aria-selected', 'true')
		expect(document.activeElement).toBe(collaborators)
		expect(profile).toHaveAttribute('tabindex', '-1')

		const collaboratorsEl = collaborators
		fireEvent.keyDown(collaboratorsEl, { key: 'ArrowLeft' })
		expect(document.activeElement).toBe(profile)
	})

	it('Home and End jump to the first and last tab', () => {
		renderSettings()
		const profile = screen.getByRole('tab', { name: /Profile & Security/i })
		profile.focus()
		fireEvent.keyDown(profile, { key: 'End' })
		expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Billing & Subscription/i }))
		fireEvent.keyDown(document.activeElement as Element, { key: 'Home' })
		expect(document.activeElement).toBe(screen.getByRole('tab', { name: /AI & Models/i }))
	})
})

describe('SIL-232 — billing round-trip return feedback', () => {
	it('confirmed checkout toasts success and scrubs the param', () => {
		renderSettings('/settings?billing=checkout_success')
		expect(toast.success).toHaveBeenCalledWith('Checkout complete — your subscription is active.')
		expect(window.location.search).not.toContain('billing')
	})

	it('cancelled checkout is honest and changes nothing', () => {
		renderSettings('/settings?billing=checkout_cancelled')
		expect(toast.info).toHaveBeenCalledWith('Checkout was cancelled — nothing has changed.')
	})

	it('portal and plan-change returns are acknowledged', () => {
		renderSettings('/settings?billing=portal_return')
		expect(toast.info).toHaveBeenCalledWith('Returned from the billing portal.')

		renderSettings('/settings?billing=plan_change_return')
		expect(toast.success).toHaveBeenCalledWith('Plan change processed — your subscription is up to date.')
	})
})

describe('SIL-232 — usage tab tier badge state', () => {
	it('shows no fabricated plan or tier while the summary is unresolved', async () => {
		const originalFetch = global.fetch
		global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch
		try {
			renderSettings()
			fireEvent.click(screen.getByRole('tab', { name: /AI Usage/i }))
			const badge = await screen.findByText('…')
			expect(badge).toBeInTheDocument()
			expect(screen.queryByText(/plan/i)).not.toBeInTheDocument()
			// The tier is unknown until the summary resolves — never print "free" as fact.
			expect(screen.queryByText(/free tier/i)).not.toBeInTheDocument()
		} finally {
			global.fetch = originalFetch
		}
	})
})
