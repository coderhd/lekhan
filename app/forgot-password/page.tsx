'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export default function ForgotPasswordPage() {
	const router = useRouter()
	const [email, setEmail] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [successMessage, setSuccessMessage] = useState<string | null>(null)

	const handleResetPassword = async (e: React.FormEvent) => {
		e.preventDefault()
		setError(null)
		setSuccessMessage(null)
		setLoading(true)

		try {
			const { error } = await supabase.auth.resetPasswordForEmail(email, {
				redirectTo: `${window.location.origin}/reset-password`,
			})

			if (error) throw error

			setSuccessMessage('Password reset link sent! Check your email.')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			setError(message)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="bg-background selection:bg-primary-container selection:text-on-primary-container min-h-screen relative overflow-hidden flex flex-col">
			{/* Ambient Glow Effects */}
			<div className="hero-glow top-0 left-0" style={{ transform: 'translate(-10%, -10%)' }}></div>
			<div className="hero-glow bottom-0 right-0" style={{ transform: 'translate(10%, 10%)' }}></div>

			{/* Top Navigation Bar */}
			<header className="w-full fixed top-0 bg-surface/5 backdrop-blur-xl border-b border-on-surface/10 z-50 flex justify-between items-center px-4 md:px-8 h-16">
				<Link href="/" className="flex items-center group cursor-pointer">
					<img alt="Lekhan Logo" className="h-6 w-6 md:h-7 md:w-7 object-contain cursor-pointer hover:scale-110 transition-transform" src="/logo.png" />
					<span className="font-display-lg text-xl md:text-2xl font-bold text-primary-container transition-colors group-hover:text-primary leading-none translate-y-[1px]">ekhan</span>
				</Link>
			</header>

			<main className="flex-1 flex items-center justify-center pt-24 pb-20 px-4">
				{/* Forgot Password Card */}
				<div className="glass w-full max-w-md rounded-xl p-6 md:p-10 flex flex-col gap-8 z-10 animate-in fade-in zoom-in duration-700">
					{successMessage ? (
						<div className="flex flex-col items-center text-center gap-6 animate-in fade-in duration-500">
							<Image alt="Check Email" className="w-full max-w-[200px] h-auto mb-2" src="/forgot-password.svg" width={200} height={150} />
							<div className="flex flex-col gap-2">
								<h2 className="font-display-md text-2xl font-bold text-on-surface">Check your inbox</h2>
								<div className="p-4 bg-[#a0f399]/10 border border-[#a0f399]/30 rounded-xl text-[#a0f399] text-sm text-center font-medium leading-relaxed">
									{successMessage}
								</div>
							</div>

							<button onClick={() => router.push('/login')} className="mt-2 w-full bg-surface text-primary-container font-bold py-3 rounded-lg shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 border border-primary-container/20">
								Return to Login
							</button>
						</div>
					) : (
						<>
							{/* Header Section */}
							<div className="flex flex-col items-center text-center gap-2">
								<Image alt="Forgot Password" className="w-full max-w-[200px] h-auto mb-4" src="/forgot-password.svg" width={200} height={150} />
								<h1 className="font-display-lg text-2xl md:text-3xl font-bold text-on-surface">Reset Password</h1>
								<p className="font-body-md text-on-surface-variant mx-auto">Enter your email to receive a reset link.</p>
							</div>

							{/* Forgot Password Form */}
							<form onSubmit={handleResetPassword} className="flex flex-col gap-5">
								{error && (
									<div className="p-3 bg-error-container/20 border border-error/50 rounded-lg text-error text-sm text-center font-medium flex items-center justify-center gap-2">
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
										{error}
									</div>
								)}

								<div className="flex flex-col gap-1.5">
									<label className="font-label-sm text-on-surface-variant ml-2 text-xs font-semibold uppercase tracking-wider">Email Address</label>
									<div className="relative group">
										<Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-5 h-5 group-focus-within:text-primary transition-colors" />
										<input
											type="email"
											value={email}
											onChange={(e) => setEmail(e.target.value)}
											required
											className="w-full bg-black/5 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg py-3 pl-10 pr-4 font-body-md text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/30 transition-all placeholder:text-on-surface-variant/50"
											placeholder="name@company.com"
										/>
									</div>
								</div>

								<button
									type="submit"
									disabled={loading || !email}
									className="mt-4 w-full bg-primary-container text-on-primary-fixed font-bold py-3 rounded-lg shadow-lg hover:shadow-primary-container/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50"
								>
									{loading ? 'Sending...' : 'Send Reset Link'}
								</button>
							</form>

							{/* Footer Link */}
							<div className="text-center">
								<p className="font-body-md text-sm text-on-surface-variant">
									Remembered your password? {' '}
									<Link href="/login" className="text-primary font-semibold hover:underline">Sign In</Link>
								</p>
							</div>
						</>
					)}
				</div>
			</main>
		</div>
	)
}
