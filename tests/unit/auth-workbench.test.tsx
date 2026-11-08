import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import SignupPage from '@/app/signup/page'
import ForgotPasswordPage from '@/app/forgot-password/page'

const auth = vi.hoisted(() => ({ signUp: vi.fn(), resetPasswordForEmail: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
beforeEach(() => { vi.clearAllMocks() })

it('keeps signup fields on failure and only confirms a successful request', async () => {
 auth.signUp.mockResolvedValueOnce({ error: new Error('Please retry') }).mockResolvedValueOnce({ error: null })
 render(<SignupPage />)
 fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Writer' } })
 fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'writer@example.com' } })
 fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } })
 fireEvent.submit(document.querySelector('form')!)
 expect(await screen.findByRole('alert')).toHaveTextContent('Please retry')
 expect(screen.getByLabelText('Email Address')).toHaveValue('writer@example.com')
 fireEvent.submit(document.querySelector('form')!)
 expect(await screen.findByRole('status')).toHaveTextContent(/check your email/i)
 expect(auth.signUp).toHaveBeenLastCalledWith(expect.objectContaining({ email: 'writer@example.com', options: { data: { full_name: 'Writer' } } }))
})

it('retains reset input on failure and waits for service success before confirmation', async () => {
 auth.resetPasswordForEmail.mockResolvedValueOnce({ error: new Error('Reset unavailable') }).mockResolvedValueOnce({ error: null })
 render(<ForgotPasswordPage />)
 fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'writer@example.com' } })
 fireEvent.submit(document.querySelector('form')!)
 expect(await screen.findByRole('alert')).toHaveTextContent('Reset unavailable')
 expect(screen.queryByText('Check your inbox')).toBeNull()
 expect(screen.getByLabelText('Email Address')).toHaveValue('writer@example.com')
 fireEvent.submit(document.querySelector('form')!)
 await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Password reset link sent!'))
 expect(auth.resetPasswordForEmail).toHaveBeenLastCalledWith('writer@example.com', { redirectTo: `${window.location.origin}/reset-password` })
})
