'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Dashboard from '@/components/dashboard'

export default function Home () {
	const router = useRouter()
	const [user, setUser] = useState<any | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const checkSession = async () => {
			try {
				const { data: { user: sessionUser } } = await supabase.auth.getUser()
				if (!sessionUser) {
					router.push('/login')
				} else {
					setUser(sessionUser)
				}
			} catch (err) {
				console.error('Session check error:', err)
				router.push('/login')
			} finally {
				setLoading(false)
			}
		}

		checkSession()

		// Listen to auth changes
		const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
			if (session) {
				setUser(session.user)
				setLoading(false)
			} else {
				setUser(null)
				router.push('/login')
			}
		})

		return () => {
			subscription.unsubscribe()
		}
	}, [router])

	if (loading) {
		return (
			<div className='flex min-h-screen items-center justify-center bg-slate-950 text-white'>
				<div className='flex flex-col items-center gap-3'>
					<span className='h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent' />
					<p className='text-sm text-slate-400 font-semibold'>Initializing workspace...</p>
				</div>
			</div>
		)
	}

	if (!user) {
		return null
	}

	return <Dashboard user={user} />
}
