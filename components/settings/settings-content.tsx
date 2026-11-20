'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchOwnedPagesWithMembers } from '@/services/graph'
import SettingsClient from '../settings-client'
import type { SettingsTab } from './settings-provider'
import styles from './settings.module.css'

export default function SettingsContent({ initialTab }: { initialTab: SettingsTab }) {
	const router = useRouter()
	const [account, setAccount] = useState<{ id: string; email: string; full_name?: string } | null>(null)
	const [pages, setPages] = useState<Awaited<ReturnType<typeof fetchOwnedPagesWithMembers>>>([])
	const [error, setError] = useState(false)
	useEffect(() => {
		let cancelled = false
		async function load() {
			const { data: { user } } = await supabase.auth.getUser()
			if (cancelled) return
			if (!user) {
				router.replace('/login')
				return
			}
			const owned = await fetchOwnedPagesWithMembers(user.id)
			if (cancelled) return
			setPages(owned)
			setAccount({ id: user.id, email: user.email ?? '', full_name: user.user_metadata?.full_name })
		}
		void load().catch(() => { if (!cancelled) setError(true) })
		return () => { cancelled = true }
	}, [router])
	if (error) return <p className={styles.message} role="alert">Settings could not be loaded. Close settings and try again.</p>
	if (!account) return <p className={styles.message} role="status">Loading settings…</p>
	return <SettingsClient user={account} initialTab={initialTab} pages={pages} />
}
