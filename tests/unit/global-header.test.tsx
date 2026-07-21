import '@testing-library/jest-dom'
import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalHeader } from '@/components/layout/global-header'
import {
	GlobalHeaderProvider,
	GlobalHeaderSlot,
} from '@/components/layout/global-header-context'

let pathname = '/'
const unsubscribe = vi.fn()

vi.mock('next/navigation', () => ({
	usePathname: () => pathname,
}))

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
			onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe } } })),
		},
	},
}))

describe('GlobalHeader', () => {
	beforeEach(() => {
		pathname = '/'
		unsubscribe.mockClear()
		Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0)
			return 1
		})
		vi.stubGlobal('cancelAnimationFrame', vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('renders one shared header and the registered route slots on non-auth routes', async () => {
		pathname = '/settings'

		render(
			<GlobalHeaderProvider>
				<GlobalHeader />
				<GlobalHeaderSlot slot="main"><span>Settings</span></GlobalHeaderSlot>
				<GlobalHeaderSlot slot="right"><button>Profile</button></GlobalHeaderSlot>
			</GlobalHeaderProvider>
		)

		expect(await screen.findByRole('banner')).toBeInTheDocument()
		expect(screen.getByText('Settings')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
	})

	it('keeps one banner when route controls register through a slot', async () => {
		pathname = '/settings'

		function RouteControls() {
			return <GlobalHeaderSlot slot="main"><span>Settings</span></GlobalHeaderSlot>
		}

		render(
			<GlobalHeaderProvider>
				<GlobalHeader />
				<RouteControls />
			</GlobalHeaderProvider>
		)

		await screen.findByText('Settings')
		expect(screen.getAllByRole('banner')).toHaveLength(1)
	})

	it.each(['/login', '/signup', '/forgot-password', '/doc/123'])('does not render the shared header on %s', (route) => {
		pathname = route
		render(<GlobalHeaderProvider><GlobalHeader /><p>Auth or editor page</p></GlobalHeaderProvider>)
		expect(screen.queryByRole('banner')).not.toBeInTheDocument()
	})

	it('hides after downward scrolling and reveals after upward scrolling', async () => {
		pathname = '/about'
		render(<GlobalHeaderProvider><GlobalHeader /><div style={{ height: 2000 }} /></GlobalHeaderProvider>)
		const header = await screen.findByRole('banner')

		expect(header).toHaveAttribute('data-header-visible', 'true')
		Object.defineProperty(window, 'scrollY', { value: 240, configurable: true })
		act(() => window.dispatchEvent(new Event('scroll')))
		expect(header).toHaveAttribute('data-header-visible', 'false')

		Object.defineProperty(window, 'scrollY', { value: 120, configurable: true })
		act(() => window.dispatchEvent(new Event('scroll')))
		expect(header).toHaveAttribute('data-header-visible', 'true')
	})
})
