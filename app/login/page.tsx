'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AccessFrame from '@/components/workbench/access-frame'
import { Mail, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { track } from '@/lib/analytics'
import { friendlyAuthError } from '@/lib/auth-error-message'

export default function LoginPage() {
	const router = useRouter()
	const [mounted, setMounted] = useState(false)
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Keep submit disabled until React has hydrated. A click on the server-rendered
	// form before then falls through to a native submit, which reloads /login and
	// silently drops the failure — the "no error until I press it again" report.
	useEffect(() => setMounted(true), [])

	const handleLogin = async (e: React.FormEvent) => {
		e.preventDefault()
		if (loading) return

		setError(null)
		setLoading(true)

		let signedIn = false
		try {
			const { error } = await supabase.auth.signInWithPassword({
				email,
				password,
			})

			if (error) throw error

			signedIn = true
			track('login_completed', { method: 'email' })
			router.push('/')
		} catch (err: unknown) {
			setError(friendlyAuthError(err))
		} finally {
			// Stay in the loading state until the destination route takes over;
			// re-enabling here allows a second submit + duplicate analytics event
			// while the RSC navigation is still resolving.
			if (!signedIn) setLoading(false)
		}
	}

	return (
		<AccessFrame>
			<div className="flex flex-col gap-8">
					{/* Header Section */}
					<div className="flex flex-col items-center text-center gap-2">
						<h1 className="font-display-lg text-2xl md:text-3xl font-bold text-on-surface">Welcome Back</h1>
						<p className="font-body-md text-on-surface-variant max-w-[280px]">Collaborate and create in your shared workspace.</p>
					</div>

					{/* Login Form */}
					<form onSubmit={handleLogin} aria-busy={loading} className="flex flex-col gap-5">
						<div className="flex flex-col gap-1.5">
							<label htmlFor="login-email" className="font-label-sm text-on-surface-variant ml-2 text-xs font-semibold uppercase tracking-wider">Email Address</label>
							<div className="relative group">
								<Mail aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-5 h-5 group-focus-within:text-primary transition-colors" />
								<input
									id="login-email"
									type="email"
									autoComplete="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									required
									className="w-full bg-black/5 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg py-3 pl-10 pr-4 font-body-md text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/30 transition-all placeholder:text-on-surface-variant/50"
									placeholder="name@company.com"
								/>
							</div>
						</div>

						<div className="flex flex-col gap-1.5">
							<div className="flex justify-between items-center px-2">
								<label htmlFor="login-password" className="font-label-sm text-on-surface-variant text-xs font-semibold uppercase tracking-wider">Password</label>
								<Link href="/forgot-password" className="text-primary text-xs font-semibold hover:underline">Forgot Password?</Link>
							</div>
							<div className="relative group">
								<Lock aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-5 h-5 group-focus-within:text-primary transition-colors" />
								<input
									id="login-password"
									type="password"
									autoComplete="current-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									className="w-full bg-black/5 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg py-3 pl-10 pr-4 font-body-md text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/30 transition-all placeholder:text-on-surface-variant/50"
									placeholder="••••••••"
								/>
							</div>
						</div>

						{error && (
							<div
								id="login-error"
								role="alert"
								aria-live="assertive"
								className="p-3 bg-error-container/20 border border-error/50 rounded-lg text-error text-sm text-center font-medium flex items-center justify-center gap-2"
							>
								<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
								{error}
							</div>
						)}

						<button
							type="submit"
							disabled={!mounted || loading}
							aria-busy={loading}
							aria-describedby={error ? 'login-error' : undefined}
							className="mt-4 w-full bg-primary-container text-on-primary-fixed font-bold py-3 rounded-lg shadow-lg hover:shadow-primary-container/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50"
						>
							{loading ? 'Signing In...' : 'Sign In'}
						</button>
					</form>

					{/* Footer Link */}
					<div className="text-center">
						<p className="font-body-md text-sm text-on-surface-variant">
							Don't have an account? {' '}
							<Link href="/signup" className="text-primary font-semibold hover:underline">Sign Up</Link>
						</p>
					</div>
			</div>
		</AccessFrame>
	)
}
