import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import SettingsClient from '@/components/settings-client'
import { GlobalHeaderProvider } from '@/components/layout/global-header-context'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
	toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/supabase', () => {
	// A then-able query chain that always resolves to "no rows" (vault load path).
	const chain: Record<string, unknown> = {}
	const node = () => chain
	for (const method of ['select', 'eq', 'order', 'limit', 'single', 'insert', 'update', 'delete']) {
		chain[method] = node
	}
	chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
	chain.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: null, error: null }).then(resolve)
	return {
		supabase: {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
				getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null }),
				onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
			},
			from: vi.fn(() => chain),
		},
	}
})

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
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
	it('confirmed checkout acknowledges honestly and scrubs the param', () => {
		renderSettings('/settings?billing=checkout_success')
		expect(toast.success).toHaveBeenCalledWith('Checkout confirmed — your tier summary below will update.')
		expect(window.location.search).not.toContain('billing')
	})

	it('cancelled checkout is honest and changes nothing', () => {
		renderSettings('/settings?billing=checkout_cancelled')
		expect(toast.info).toHaveBeenCalledWith('Checkout was cancelled — nothing has changed.')
	})

	it('portal and plan-change returns are acknowledged without claiming a change', () => {
		renderSettings('/settings?billing=portal_return')
		expect(toast.info).toHaveBeenCalledWith('Returned from the payment portal.')

		renderSettings('/settings?billing=plan_change_return')
		expect(toast.info).toHaveBeenCalledWith('Returned from the payment portal.')
		// A backed-out portal exit must never read as a confirmed success.
		expect(toast.success).not.toHaveBeenCalledWith(/plan/i)
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

	it('on summary failure the badge stays silent instead of printing "free tier"', async () => {
		const originalFetch = global.fetch
		global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
		try {
			renderSettings()
			fireEvent.click(screen.getByRole('tab', { name: /AI Usage/i }))
			expect(await screen.findByText('…')).toBeInTheDocument()
			expect(screen.queryByText(/free tier/i)).not.toBeInTheDocument()
			fireEvent.click(screen.getByRole('tab', { name: /Billing & Subscription/i }))
			// The honest error state renders on the billing surface (role=alert card).
			expect(await screen.findByRole('alert')).toHaveTextContent('offline')
		} finally {
			global.fetch = originalFetch
		}
	})
})
