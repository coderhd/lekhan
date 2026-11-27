'use client'

import { useEffect, useRef } from 'react'
import { identifyUser, resetAnalytics } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'

interface AnalyticsProviderProps {
	children: React.ReactNode
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
	const identifiedUserId = useRef<string | null>(null)

	useEffect(() => {
		const identifySessionUser = (user: { id: string; email?: string }) => {
			if (identifiedUserId.current === user.id) return

			// Supabase can switch directly from one account to another without a
			// SIGNED_OUT event. Reset first so the next identify starts cleanly.
			if (identifiedUserId.current) resetAnalytics()

			identifyUser(user.id, user.email ? { email: user.email } : undefined)
			identifiedUserId.current = user.id
		}

		// Identify a persisted session once on refresh, then retain that identity
		// in posthog-js until Supabase reports a logout or account switch.
		supabase.auth.getSession().then(({ data: { session } }) => {
			if (session?.user) identifySessionUser(session.user)
		})

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((event, session) => {
			if (event === 'SIGNED_IN' && session?.user) {
				identifySessionUser(session.user)
			} else if (event === 'SIGNED_OUT') {
				resetAnalytics()
				identifiedUserId.current = null
			}
		})

		return () => {
			subscription.unsubscribe()
		}
	}, [])

	return <>{children}</>
}
