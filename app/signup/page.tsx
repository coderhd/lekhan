'use client'

import { useState, useEffect } from 'react'

import Link from 'next/link'
import AccessFrame from '@/components/workbench/access-frame'
import Image from 'next/image'
import { Mail, Lock, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { track } from '@/lib/analytics'

export default function SignupPage() {
	const [fullName, setFullName] = useState('')
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [successMessage, setSuccessMessage] = useState<string | null>(null)
	// Referral capture (PDEC-5): read `?ref` once at mount and pass it on signup so the
	// handle_new_user companion trigger can persist referral_attribution. No UI change.
	const [referredBy, setReferredBy] = useState<string | null>(null)

	useEffect(() => {
		const ref = new URLSearchParams(window.location.search).get('ref')
		setReferredBy(ref ? ref.trim().slice(0, 100) : null)
	}, [])

	const handleSignup = async (e: React.FormEvent) => {
		e.preventDefault()
		if (loading) return
		setError(null)
		setSuccessMessage(null)
		setLoading(true)
		track('signup_started', { method: 'email' })

		try {
			const { error } = await supabase.auth.signUp({
				email,
				password,
				options: {
					data: {
						full_name: fullName,
						...(referredBy ? { referred_by: referredBy } : {}),
					},
				},
			})

			if (error) throw error

			track('signup_completed', { method: 'email' })
			setSuccessMessage('Your account has been created! Please check your email to verify your account before logging in. You may close this window.')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			setError(message)
		} finally {
			setLoading(false)
		}
	}

	return (
		<AccessFrame>
			<div className="flex flex-col gap-8">
					{successMessage ? (
						<div className="flex flex-col items-center text-center gap-6 animate-in fade-in duration-500">
							<Image alt="Welcome to Lekhan" className="w-full max-w-[200px] h-auto mb-2" src="/welcome.svg" width={200} height={150} />
							{/* <div className="flex flex-col gap-2"> */}
							{/* <h2 className="font-display-md text-2xl font-bold text-on-surface">Welcome aboard!</h2> */}
							<div role="status" className="p-4 bg-[#a0f399]/10 border border-[#a0f399]/30 rounded-xl text-[#a0f399] text-sm text-center font-medium leading-relaxed">
								{successMessage}
							</div>
							{/* </div> */}

							<div className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-4 flex flex-col gap-4 text-left mt-2">
								<div>
									<label htmlFor="signup-name" className="font-label-sm text-on-surface-variant text-[10px] font-bold uppercase tracking-wider block mb-1">Full Name</label>
									<div className="font-body-md text-on-surface font-medium">{fullName}</div>
								</div>
								<div>
									<label htmlFor="signup-email" className="font-label-sm text-on-surface-variant text-[10px] font-bold uppercase tracking-wider block mb-1">Email Address</label>
									<div className="font-body-md text-on-surface font-medium">{email}</div>
								</div>
							</div>

							{/* <button onClick={() => router.push('/login')} className="mt-2 w-full bg-surface text-primary-container font-bold py-3 rounded-lg shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 border border-primary-container/20">
								Go to Login
							</button> */}
						</div>
					) : (
						<>
							{/* Header Section */}
							<div className="flex flex-col items-center text-center gap-2">
								<Image alt="Lekhan Workspace Logo" className="w-16 h-16 md:w-20 md:h-20 mb-4" src="/logo.png" width={80} height={80} />
								<h1 className="font-display-lg text-2xl md:text-3xl font-bold text-on-surface">Join Lekhan</h1>
								<p className="font-body-md text-on-surface-variant max-w-[280px]">Start your creative journey today.</p>
							</div>

							{/* Signup Form */}
							<form onSubmit={handleSignup} className="flex flex-col gap-5">
								{error && (
									<div role="alert" className="p-3 bg-error-container/20 border border-error/50 rounded-lg text-error text-sm text-center font-medium flex items-center justify-center gap-2">
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
										{error}
									</div>
								)}

								<div className="flex flex-col gap-1.5">
									<label htmlFor="signup-name" className="font-label-sm text-on-surface-variant ml-2 text-xs font-semibold uppercase tracking-wider">Full Name</label>
									<div className="relative group">
										<User className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-5 h-5 group-focus-within:text-primary transition-colors" />
										<input
											type="text" id="signup-name" autoComplete="name"
											value={fullName}
											onChange={(e) => setFullName(e.target.value)}
											required
											className="w-full bg-black/5 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg py-3 pl-10 pr-4 font-body-md text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/30 transition-all placeholder:text-on-surface-variant/50"
											placeholder="John Doe"
										/>
									</div>
								</div>

								<div className="flex flex-col gap-1.5">
									<label htmlFor="signup-email" className="font-label-sm text-on-surface-variant ml-2 text-xs font-semibold uppercase tracking-wider">Email Address</label>
									<div className="relative group">
										<Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-5 h-5 group-focus-within:text-primary transition-colors" />
										<input
											type="email" id="signup-email" autoComplete="email"
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
										<label htmlFor="signup-password" className="font-label-sm text-on-surface-variant text-xs font-semibold uppercase tracking-wider">Password</label>
									</div>
									<div className="relative group">
										<Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-5 h-5 group-focus-within:text-primary transition-colors" />
										<input
											type="password" id="signup-password" autoComplete="new-password"
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											required
											className="w-full bg-black/5 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg py-3 pl-10 pr-4 font-body-md text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/30 transition-all placeholder:text-on-surface-variant/50"
											placeholder="••••••••"
										/>
									</div>
								</div>

								<button
									type="submit"
									disabled={loading}
									className="mt-4 w-full bg-primary-container text-on-primary-fixed font-bold py-3 rounded-lg shadow-lg hover:shadow-primary-container/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50"
								>
									{loading ? 'Creating Account...' : 'Create Account'}
								</button>
							</form>

							{/* Footer Link */}
							<div className="text-center">
								<p className="font-body-md text-sm text-on-surface-variant">
									Already have an account? {' '}
									<Link href="/login" className="text-primary font-semibold hover:underline">Sign In</Link>
								</p>
							</div>
						</>
					)}
			</div>
		</AccessFrame>
	)
}
