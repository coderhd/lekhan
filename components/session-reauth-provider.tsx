'use client'

import React, { createContext, useContext, useEffect, useState, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Lock, LogOut, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'

// Context to expose reauth state if needed by other components
const SessionReauthContext = createContext<{
	isLocked: boolean
	lockSession: () => void
	unlockSession: () => void
} | null>(null)

export const useSessionReauth = () => {
	const context = useContext(SessionReauthContext)
	if (!context) {
		throw new Error('useSessionReauth must be used within a SessionReauthProvider')
	}
	return context
}

// Configurable constants (in milliseconds)
const DEFAULT_INACTIVITY_TIMEOUT = 15 * 60 * 1000 // 15 minutes
const DEFAULT_TIMEBOX_TIMEOUT = 12 * 60 * 60 * 1000 // 12 hours

// Exclude public pages where reauth shouldn't block the user
const PUBLIC_PATHS = [
	'/login',
	'/signup',
	'/forgot-password',
	'/about',
	'/faq',
	'/contact',
	'/privacy-policy',
	'/terms-of-service'
]

export function SessionReauthProvider({ children }: { children: React.ReactNode }) {
	const pathname = usePathname()
	const router = useRouter()

	const [isLocked, setIsLocked] = useState(false)
	const [userEmail, setUserEmail] = useState<string | null>(null)
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [verifying, setVerifying] = useState(false)
	
	const activityTimer = useRef<NodeJS.Timeout | null>(null)
	const isChecking = useRef(false)

	// Determine if the current route is protected/enforced
	const isProtectedRoute = !PUBLIC_PATHS.some(path => pathname === path || pathname?.startsWith('/invite/'))

	// Record activity
	const recordActivity = () => {
		if (typeof window !== 'undefined' && !isLocked) {
			localStorage.setItem('lekhan_last_activity', Date.now().toString())
		}
	}

	// Lock the session
	const lockSession = () => {
		setIsLocked(true)
		setError(null)
		setPassword('')
	}

	// Unlock session manually (after successful reauth)
	const unlockSession = () => {
		setIsLocked(false)
		setPassword('')
		setError(null)
		recordActivity()
		// Reset session start time to prevent immediate time-box trigger again
		localStorage.setItem('lekhan_session_start', Date.now().toString())
	}

	// Listen for auth session and set email
	useEffect(() => {
		const checkSession = async () => {
			const { data: { session } } = await supabase.auth.getSession()
			if (session?.user) {
				setUserEmail(session.user.email ?? null)
				// Set initial session start time if not present
				if (!localStorage.getItem('lekhan_session_start')) {
					localStorage.setItem('lekhan_session_start', Date.now().toString())
				}
			} else {
				setUserEmail(null)
			}
		}

		checkSession()

		const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
			if (session?.user) {
				setUserEmail(session.user.email ?? null)
				if (!localStorage.getItem('lekhan_session_start')) {
					localStorage.setItem('lekhan_session_start', Date.now().toString())
				}
			} else {
				setUserEmail(null)
				setIsLocked(false)
			}
		})

		return () => {
			subscription.unsubscribe()
		}
	}, [])

	// Setup activity event listeners
	useEffect(() => {
		if (typeof window === 'undefined') return

		const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart']
		
		events.forEach(event => {
			window.addEventListener(event, recordActivity)
		})

		// Initialize timestamps
		if (!localStorage.getItem('lekhan_last_activity')) {
			localStorage.setItem('lekhan_last_activity', Date.now().toString())
		}

		return () => {
			events.forEach(event => {
				window.removeEventListener(event, recordActivity)
			})
		}
	}, [isLocked])

	// Check intervals for inactivity & timebox timeouts
	useEffect(() => {
		if (!isProtectedRoute || !userEmail || isLocked) return

		const checkTimeouts = () => {
			if (isChecking.current) return
			isChecking.current = true

			const now = Date.now()
			
			// 1. Inactivity check
			const lastActivityStr = localStorage.getItem('lekhan_last_activity')
			const lastActivity = lastActivityStr ? parseInt(lastActivityStr, 10) : now
			
			// Support developer testing override
			const testInactivityTimeout = localStorage.getItem('lekhan_test_inactivity_timeout')
			const inactivityTimeoutLimit = testInactivityTimeout 
				? parseInt(testInactivityTimeout, 10) 
				: DEFAULT_INACTIVITY_TIMEOUT

			if (now - lastActivity >= inactivityTimeoutLimit) {
				console.log('[Security] Inactivity timeout triggered')
				lockSession()
				isChecking.current = false
				return
			}

			// 2. Time-box check (max session life)
			const sessionStartStr = localStorage.getItem('lekhan_session_start')
			const sessionStart = sessionStartStr ? parseInt(sessionStartStr, 10) : now
			
			const testTimeboxTimeout = localStorage.getItem('lekhan_test_timebox_timeout')
			const timeboxTimeoutLimit = testTimeboxTimeout 
				? parseInt(testTimeboxTimeout, 10) 
				: DEFAULT_TIMEBOX_TIMEOUT

			if (now - sessionStart >= timeboxTimeoutLimit) {
				console.log('[Security] Session timebox timeout triggered')
				lockSession()
				isChecking.current = false
				return
			}

			isChecking.current = false
		}

		// Run check every 5 seconds
		activityTimer.current = setInterval(checkTimeouts, 5000)

		// Also check on window focus
		window.addEventListener('focus', checkTimeouts)

		return () => {
			if (activityTimer.current) clearInterval(activityTimer.current)
			window.removeEventListener('focus', checkTimeouts)
		}
	}, [isProtectedRoute, userEmail, isLocked])

	const handleReauth = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!userEmail) return

		setError(null)
		setVerifying(true)

		try {
			const { error } = await supabase.auth.signInWithPassword({
				email: userEmail,
				password,
			})

			if (error) throw error

			unlockSession()
			toast.success('Session unlocked successfully')
		} catch (err: any) {
			setError(err.message || 'Invalid password. Please try again.')
		} finally {
			setVerifying(false)
		}
	}

	const handleSignOut = async () => {
		try {
			await supabase.auth.signOut()
			setIsLocked(false)
			router.push('/login')
			toast.success('Signed out successfully')
		} catch (err) {
			console.error('Sign out error:', err)
		}
	}

	return (
		<SessionReauthContext.Provider value={{ isLocked, lockSession, unlockSession }}>
			{children}

			{/* Reauthentication Modal Overlay */}
			{isLocked && (
				<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md px-4 animate-in fade-in duration-300">
					<div className="glass w-full max-w-md rounded-2xl p-6 md:p-8 flex flex-col gap-6 border border-white/10 shadow-2xl relative">
						
						{/* Icon & Title */}
						<div className="flex flex-col items-center text-center gap-3">
							<div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary animate-pulse">
								<ShieldAlert className="w-7 h-7" />
							</div>
							<h2 className="font-display-lg text-2xl font-bold text-on-surface">Session Locked</h2>
							<p className="font-body-md text-sm text-on-surface-variant max-w-[280px]">
								For your security, please verify your password to continue writing.
							</p>
						</div>

						{/* Form */}
						<form onSubmit={handleReauth} className="flex flex-col gap-4">
							{error && (
								<div className="p-3 bg-error-container/20 border border-error/50 rounded-lg text-error text-xs font-semibold flex items-center gap-2">
									<span className="material-symbols-outlined text-[16px]">error</span>
									{error}
								</div>
							)}

							<div className="flex flex-col gap-1.5">
								<label className="font-label-sm text-on-surface-variant text-[11px] font-bold uppercase tracking-wider ml-1">
									Account
								</label>
								<div className="w-full bg-black/10 dark:bg-white/5 border border-white/5 rounded-lg px-4 py-3 text-sm text-on-surface/70 select-none">
									{userEmail}
								</div>
							</div>

							<div className="flex flex-col gap-1.5">
								<label className="font-label-sm text-on-surface-variant text-[11px] font-bold uppercase tracking-wider ml-1">
									Password
								</label>
								<div className="relative">
									<input
										type="password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										required
										className="w-full bg-black/15 dark:bg-black/40 border border-white/10 rounded-lg py-3 px-4 font-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all text-sm"
										placeholder="Enter your password"
										autoFocus
									/>
								</div>
							</div>

							<button
								type="submit"
								disabled={verifying || !password}
								className="mt-2 w-full bg-primary-container text-on-primary-fixed font-bold py-3 rounded-lg shadow-lg hover:bg-primary transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
							>
								{verifying ? (
									<>
										<span className="animate-spin rounded-full h-4 w-4 border-2 border-on-primary-fixed border-t-transparent"></span>
										Verifying...
									</>
								) : (
									<>
										<Lock className="w-4 h-4" />
										Verify Password
									</>
								)}
							</button>
						</form>

						{/* Sign out fallback */}
						<div className="border-t border-white/5 pt-4 flex justify-center">
							<button
								onClick={handleSignOut}
								className="text-xs text-muted-foreground hover:text-error transition-colors flex items-center gap-1.5 font-medium"
							>
								<LogOut className="w-3.5 h-3.5" />
								Sign out of this account
							</button>
						</div>
					</div>
				</div>
			)}
		</SessionReauthContext.Provider>
	)
}
