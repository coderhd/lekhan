'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage () {
	const router = useRouter()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [fullName, setFullName] = useState('')
	const [isSignUp, setIsSignUp] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError(null)
		setLoading(true)

		try {
			if (isSignUp) {
				const { error: signUpError } = await supabase.auth.signUp({
					email,
					password,
					options: {
						data: {
							full_name: fullName,
						},
					},
				})
				if (signUpError) {
					throw signUpError
				}
				alert('Sign up successful! Please log in.')
				setIsSignUp(false)
			} else {
				const { error: signInError } = await supabase.auth.signInWithPassword({
					email,
					password,
				})
				if (signInError) {
					throw signInError
				}
				router.push('/')
			}
		} catch (err: any) {
			setError(err.message || 'Something went wrong')
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className='flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-black p-4'>
			<div className='w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/60 p-8 backdrop-blur-xl shadow-2xl'>
				<div className='flex flex-col items-center mb-6'>
					<img src='/logo.png' alt='Lekhan Logo' className='h-20 w-20 rounded-2xl shadow-lg border border-white/10 mb-3' />
					<h2 className='text-3xl font-extrabold tracking-tight text-white'>
						{isSignUp ? 'Join Lekhan' : 'Welcome to Lekhan'}
					</h2>
				</div>

				{error && (
					<div className='mb-4 rounded-lg bg-red-950/50 border border-red-500/30 p-3 text-sm text-red-400'>
						{error}
					</div>
				)}

				<form onSubmit={handleSubmit} className='space-y-4'>
					{isSignUp && (
						<div>
							<label className='block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1'>
								Full Name
							</label>
							<input
								type='text'
								value={fullName}
								onChange={(e) => setFullName(e.target.value)}
								className='w-full rounded-lg border border-slate-700 bg-slate-800/50 p-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none'
								placeholder='Jane Doe'
								required
							/>
						</div>
					)}

					<div>
						<label className='block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1'>
							Email Address
						</label>
						<input
							type='email'
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className='w-full rounded-lg border border-slate-700 bg-slate-800/50 p-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none'
							placeholder='you@example.com'
							required
						/>
					</div>

					<div>
						<label className='block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1'>
							Password
						</label>
						<input
							type='password'
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className='w-full rounded-lg border border-slate-700 bg-slate-800/50 p-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none'
							placeholder='••••••••'
							required
						/>
					</div>

					<button
						type='submit'
						disabled={loading}
						className='w-full rounded-lg bg-indigo-600 p-2.5 font-semibold text-white shadow-lg transition duration-200 hover:bg-indigo-500 active:scale-95 disabled:pointer-events-none disabled:opacity-50'
					>
						{loading ? 'Processing...' : isSignUp ? 'Sign Up' : 'Log In'}
					</button>
				</form>

				<div className='mt-6 text-center text-sm text-slate-400'>
					{isSignUp ? 'Already have an account?' : 'New here?'}{' '}
					<button
						onClick={() => setIsSignUp(!isSignUp)}
						className='font-semibold text-indigo-400 hover:underline'
					>
						{isSignUp ? 'Log In' : 'Sign Up'}
					</button>
				</div>
			</div>
		</div>
	)
}
