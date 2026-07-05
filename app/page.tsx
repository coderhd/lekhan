'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Dashboard from '@/components/dashboard'
import GlobalLoader from '@/components/global-loader'
import LandingPage from '@/components/landing-page'

export default function Home () {
	const router = useRouter()
	const [user, setUser] = useState<any | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const checkSession = async () => {
			try {
				const { data: { user: sessionUser } } = await supabase.auth.getUser()
				if (sessionUser) {
					setUser(sessionUser)
				}
			} catch (err) {
				console.error('Session check error:', err)
			} finally {
				setLoading(false)
			}
		}

		checkSession()

		// Listen to auth changes
		const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
			if (session) {
				setUser(session.user)
			} else {
				setUser(null)
			}
			setLoading(false)
		})

		return () => {
			subscription.unsubscribe()
		}
	}, [router])

	if (loading) {
		return <GlobalLoader text="Loading..." />
	}

	if (!user) {
		return <LandingPage />
	}

	return <Dashboard user={{
		id: user.id,
		email: user.email,
		full_name: user.user_metadata?.full_name
	}} />
}
