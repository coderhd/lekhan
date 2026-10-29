'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { resolveOwnerWorkspaceEntitlement } from '@/lib/billing/entitlements'

/**
 * T12 — the plan badge source for header surfaces.
 *
 * Reads the workspace entitlement directly (owner-readable via RLS). If the read
 * fails we show honest "Free" rather than inventing a paid badge — this is a
 * display-only reader; enforcement never depends on it.
 */
export function usePlanTier(userId?: string): { tier: string; loading: boolean } {
	const [tier, setTier] = useState('free')
	const [loading, setLoading] = useState(Boolean(userId))

	useEffect(() => {
		let cancelled = false
		if (!userId) {
			setTier('free')
			setLoading(false)
			return
		}

		const load = async () => {
			try {
				const entitlement = await resolveOwnerWorkspaceEntitlement(userId, supabase)
				if (!cancelled) setTier(entitlement?.tier ?? 'free')
			} catch {
				if (!cancelled) setTier('free')
			} finally {
				if (!cancelled) setLoading(false)
			}
		}
		void load()
		return () => {
			cancelled = true
		}
	}, [userId])

	return { tier, loading }
}
