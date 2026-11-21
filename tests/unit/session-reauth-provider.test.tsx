import '@testing-library/jest-dom'
import React from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionReauthProvider, useSessionReauth } from '@/components/session-reauth-provider'

import { SettingsProvider, useOpenSettings } from '@/components/settings/settings-provider'
vi.mock('@/components/settings/settings-content', () => ({ default: () => <div>Profile</div> }))

function SettingsTrigger() {
	const open = useOpenSettings()
	return <button onClick={event => open('profile', event.currentTarget)}>Settings</button>
}

let pathname = '/'
let authCallback: ((event: string, session: any) => void) | null = null

vi.mock('next/navigation', () => ({
	usePathname: () => pathname,
	useRouter: () => ({
		push: vi.fn(),
	}),
}))

const mockSignOut = vi.fn().mockResolvedValue({ error: null })
const mockSignInWithPassword = vi.fn().mockResolvedValue({ error: null })

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getSession: async () => ({ data: { session: null } }),
			onAuthStateChange: vi.fn((cb) => {
				authCallback = cb
				return { data: { subscription: { unsubscribe: vi.fn() } } }
			}),
			signOut: () => mockSignOut(),
			signInWithPassword: (args: any) => mockSignInWithPassword(args),
		},
	},
}))

function TestComponent() {
	const { isLocked, lockSession } = useSessionReauth()
	return (
		<div>
			<p data-testid="status">{isLocked ? 'locked' : 'unlocked'}</p>
			<button onClick={lockSession}>Lock Session</button>
		</div>
	)
}

describe('SessionReauthProvider', () => {
	beforeEach(() => {
		pathname = '/'
		authCallback = null
		localStorage.clear()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('resets stale timestamps on SIGNED_IN event so session lock does not trigger after signin', async () => {
		// Simulate stale timestamps in localStorage from hours ago
		const staleTime = Date.now() - (24 * 60 * 60 * 1000)
		localStorage.setItem('lekhan_last_activity', staleTime.toString())
		localStorage.setItem('lekhan_session_start', staleTime.toString())

		render(
			<SessionReauthProvider>
				<TestComponent />
			</SessionReauthProvider>
		)

		await act(async () => {})

		// Trigger auth state change for SIGNED_IN
		act(() => {
			if (authCallback) {
				authCallback('SIGNED_IN', { user: { email: 'user@example.com' } })
			}
		})

		// Advance time by 5s to run checkTimeouts
		act(() => {
			vi.advanceTimersByTime(5000)
		})

		// Session should remain unlocked because SIGNED_IN updated the timestamps to fresh now
		expect(screen.getByTestId('status')).toHaveTextContent('unlocked')
		expect(screen.queryByText('Session Locked')).not.toBeInTheDocument()
	})

	it('keeps the password focused after the settings focus scope unmounts on lock', async () => {
		render(<SessionReauthProvider><SettingsProvider><SettingsTrigger /></SettingsProvider></SessionReauthProvider>)
		await act(async () => {})
		act(() => authCallback?.('SIGNED_IN', { user: { email: 'user@example.com' } }))
		const trigger = screen.getByRole('button', { name: 'Settings' })
		trigger.focus()
		fireEvent.click(trigger)
		expect(screen.getByRole('dialog')).toBeInTheDocument()
		localStorage.setItem('lekhan_test_inactivity_timeout', '0')
		act(() => { window.dispatchEvent(new Event('focus')) })
		act(() => { vi.advanceTimersByTime(100) })
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		expect(screen.getByPlaceholderText('Enter your password')).toHaveFocus()
		expect(document.body.style.pointerEvents).not.toBe('none')
	})

	it('clears session timestamps from localStorage when user signs out', async () => {
		localStorage.setItem('lekhan_last_activity', Date.now().toString())
		localStorage.setItem('lekhan_session_start', Date.now().toString())

		render(
			<SessionReauthProvider>
				<TestComponent />
			</SessionReauthProvider>
		)

		await act(async () => {})

		// Trigger auth state change for SIGNED_OUT
		act(() => {
			if (authCallback) {
				authCallback('SIGNED_OUT', null)
			}
		})

		expect(localStorage.getItem('lekhan_last_activity')).toBeNull()
		expect(localStorage.getItem('lekhan_session_start')).toBeNull()
	})
})
