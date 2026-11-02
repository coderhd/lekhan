import '@testing-library/jest-dom'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from '@/app/login/page'

const push = vi.fn()
const signInWithPassword = vi.fn()
const track = vi.fn()

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push }),
}))

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
		},
	},
}))

vi.mock('@/lib/analytics', () => ({
	track: (...args: unknown[]) => track(...args),
}))

function fillCredentials(email = 'user@example.com', password = 'wrong-password') {
	fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } })
	fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: password } })
}

function submitForm() {
	const form = document.querySelector('form')
	if (!form) throw new Error('login form not found')
	fireEvent.submit(form)
}

function submitCredentials(email?: string, password?: string) {
	fillCredentials(email, password)
	fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
}

describe('LoginPage failure surfacing', () => {
	beforeEach(() => {
		push.mockReset()
		track.mockReset()
		signInWithPassword.mockReset()
	})

	it('renders the submit button disabled before hydration so the first press cannot native-submit', () => {
		const html = renderToStaticMarkup(<LoginPage />)
		expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/)
	})

	it('surfaces an invalid-credentials failure immediately as an accessible alert with friendly copy', async () => {
		signInWithPassword.mockResolvedValue({
			data: { user: null, session: null },
			error: Object.assign(new Error('Invalid login credentials'), {
				status: 400,
				code: 'invalid_credentials',
			}),
		})

		render(<LoginPage />)
		submitCredentials()

		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent(/email or password is incorrect/i)
		expect(alert).not.toHaveTextContent(/invalid login credentials/i)
		expect(alert).toHaveAttribute('aria-live', 'assertive')
		expect(signInWithPassword).toHaveBeenCalledWith({
			email: 'user@example.com',
			password: 'wrong-password',
		})
		expect(push).not.toHaveBeenCalled()
	})

	it('does not leak provider internals for network and rate-limit failures', async () => {
		signInWithPassword.mockResolvedValueOnce({
			data: { user: null, session: null },
			error: Object.assign(new TypeError('Failed to fetch'), { status: 0 }),
		})

		const { unmount } = render(<LoginPage />)
		submitCredentials()
		expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t reach the server/i)
		unmount()

		signInWithPassword.mockResolvedValueOnce({
			data: { user: null, session: null },
			error: Object.assign(new Error('Email rate limit exceeded'), { status: 429 }),
		})

		render(<LoginPage />)
		submitCredentials()
		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent(/too many attempts/i)
		expect(alert).not.toHaveTextContent(/rate limit/i)
	})

	it('tells an unconfirmed user what to do next', async () => {
		signInWithPassword.mockResolvedValue({
			data: { user: null, session: null },
			error: Object.assign(new Error('Email not confirmed'), {
				status: 400,
				code: 'email_not_confirmed',
			}),
		})

		render(<LoginPage />)
		submitCredentials()
		expect(await screen.findByRole('alert')).toHaveTextContent(/confirm your email/i)
	})

	it('falls back to a plain retry message for unknown failures', async () => {
		signInWithPassword.mockResolvedValue({
			data: { user: null, session: null },
			error: Object.assign(new Error('AuthApiError: unexpected_failure_code'), { status: 500 }),
		})

		render(<LoginPage />)
		submitCredentials()
		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent(/couldn.t sign you in/i)
		expect(alert).not.toHaveTextContent(/unexpected_failure_code/i)
	})

	it('keeps the submit control locked while the request is in flight', async () => {
		let resolveSignIn: (value: unknown) => void = () => {}
		signInWithPassword.mockReturnValue(
			new Promise((resolve) => {
				resolveSignIn = resolve
			})
		)

		render(<LoginPage />)
		submitCredentials()

		const pendingButton = await screen.findByRole('button', { name: /signing in/i })
		expect(pendingButton).toBeDisabled()
		expect(pendingButton).toHaveAttribute('aria-busy', 'true')

		// Drive the form (not the disabled button, whose click is a no-op) so this
		// actually exercises the in-handler guard.
		submitForm()
		expect(signInWithPassword).toHaveBeenCalledTimes(1)

		await act(async () => {
			resolveSignIn({
				data: { user: null, session: null },
				error: Object.assign(new Error('Invalid login credentials'), { status: 400 }),
			})
		})

		await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled())
		expect(signInWithPassword).toHaveBeenCalledTimes(1)
	})

	it('stays locked after success until the destination route takes over', async () => {
		signInWithPassword.mockResolvedValue({
			data: { user: { id: 'user-1' }, session: { access_token: 'token' } },
			error: null,
		})

		render(<LoginPage />)
		submitCredentials()

		await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
		expect(track).toHaveBeenCalledWith('login_completed', { method: 'email' })
		expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
		expect(signInWithPassword).toHaveBeenCalledTimes(1)
	})
})
