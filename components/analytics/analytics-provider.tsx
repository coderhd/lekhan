'use client'

import { useEffect } from 'react'
import { initAnalytics, identifyUser, resetAnalytics } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'

interface AnalyticsProviderProps {
	children: React.ReactNode
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
	useEffect(() => {
		// 1. Initialize analytics destinations
		initAnalytics()

		// 2. Initial session check
		supabase.auth.getSession().then(({ data: { session } }) => {
			if (session?.user) {
				identifyUser(session.user.id, {
					email: session.user.email || '',
				})
			}
		})

		// 3. Listen to auth changes
		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((event, session) => {
			if (session?.user && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
				identifyUser(session.user.id, {
					email: session.user.email || '',
				})
			} else if (event === 'SIGNED_OUT') {
				resetAnalytics()
			}
		})

		return () => {
			subscription.unsubscribe()
		}
	}, [])

	return <>{children}</>
}
