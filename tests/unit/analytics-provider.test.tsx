import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AnalyticsProvider } from '@/components/analytics/analytics-provider'
import * as analytics from '@/lib/analytics'
import { supabase } from '@/lib/supabase'

vi.mock('@/lib/analytics', () => ({
	initAnalytics: vi.fn(),
	identifyUser: vi.fn(),
	resetAnalytics: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
			onAuthStateChange: vi.fn().mockReturnValue({
				data: { subscription: { unsubscribe: vi.fn() } },
			}),
		},
	},
}))

describe('AnalyticsProvider', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('initializes analytics on mount and renders children', () => {
		const { getByText } = render(
			<AnalyticsProvider>
				<div>Child Content</div>
			</AnalyticsProvider>
		)

		expect(getByText('Child Content')).toBeInTheDocument()
		expect(analytics.initAnalytics).toHaveBeenCalled()
	})

	it('identifies user if session already exists on mount', async () => {
		vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
			data: {
				session: {
					user: { id: 'usr-1', email: 'user@example.com' },
				} as any,
			},
			error: null,
		} as any)

		render(
			<AnalyticsProvider>
				<span>App</span>
			</AnalyticsProvider>
		)

		await vi.waitFor(() => {
			expect(analytics.identifyUser).toHaveBeenCalledWith('usr-1', {
				email: 'user@example.com',
			})
		})
	})

	it('handles auth state changes: SIGNED_IN identifies, SIGNED_OUT resets', () => {
		let authCallback: (event: any, session: any) => void = () => {}
		vi.mocked(supabase.auth.onAuthStateChange).mockImplementationOnce((cb: any) => {
			authCallback = cb
			return { data: { subscription: { unsubscribe: vi.fn() } } } as any
		})

		render(
			<AnalyticsProvider>
				<span>App</span>
			</AnalyticsProvider>
		)

		authCallback('SIGNED_IN', {
			user: { id: 'usr-2', email: 'user2@example.com' },
		})
		expect(analytics.identifyUser).toHaveBeenCalledWith('usr-2', {
			email: 'user2@example.com',
		})

		authCallback('SIGNED_OUT', null)
		expect(analytics.resetAnalytics).toHaveBeenCalled()
	})
})
