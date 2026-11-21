'use client'

import { useEffect, useState } from 'react'
import { isAuthSessionMissingError } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchOwnedPagesWithMembers } from '@/services/graph'
import SettingsClient from '../settings-client'
import type { SettingsTab } from './settings-provider'
import styles from './settings.module.css'

type SettingsState =
	| { status: 'loading' | 'signed-out' | 'error' }
	| {
		status: 'ready'
		version: number
		account: { id: string; email: string; full_name?: string }
		pages: Awaited<ReturnType<typeof fetchOwnedPagesWithMembers>>
	}

export default function SettingsContent({ initialTab, redirectOnSignOut }: {
	initialTab: SettingsTab
	redirectOnSignOut?: boolean
}) {
	const router = useRouter()
	const [state, setState] = useState<SettingsState>({ status: 'loading' })

	useEffect(() => {
		let version = 0
		let receivedAuthChange = false
		let userId: string | null | undefined
		let timer: ReturnType<typeof setTimeout> | undefined

		async function load(requestVersion: number) {
			try {
				const { data: { user }, error } = await supabase.auth.getUser()
				if (requestVersion !== version) return
				const missingSession = isAuthSessionMissingError(error)
					|| error?.code === 'session_not_found' || error?.code === 'session_expired'
				if (error && !missingSession) throw error
				if (!user) {
					userId = null
					setState({ status: 'signed-out' })
					return
				}
				if (userId !== undefined && userId !== user.id) {
					setState({ status: 'error' })
					return
				}
				userId = user.id
				const pages = await fetchOwnedPagesWithMembers(user.id)
				if (requestVersion !== version) return
				setState({
					status: 'ready',
					version: requestVersion,
					account: { id: user.id, email: user.email ?? '', full_name: user.user_metadata?.full_name },
					pages,
				})
			} catch {
				if (requestVersion === version) setState({ status: 'error' })
			}
		}

		const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
			// An initial session can be empty after a failed auth request or arrive after a newer event.
			if (event === 'INITIAL_SESSION' && (!session || receivedAuthChange)) return
			const nextUserId = session?.user.id ?? null
			if (event === 'INITIAL_SESSION' && userId === undefined) {
				userId = nextUserId
				return
			}
			if (event !== 'INITIAL_SESSION') receivedAuthChange = true
			if (nextUserId === userId) return

			userId = nextUserId
			const requestVersion = ++version
			clearTimeout(timer)
			setState({ status: nextUserId === null ? 'signed-out' : 'loading' })
			// Start auth calls after Supabase releases its auth callback.
			if (nextUserId !== null) timer = setTimeout(() => void load(requestVersion), 0)
		})

		if (version === 0) void load(version)
		return () => {
			version++
			clearTimeout(timer)
			subscription.unsubscribe()
		}
	}, [])

	useEffect(() => {
		if (redirectOnSignOut && state.status === 'signed-out') router.replace('/login')
	}, [redirectOnSignOut, router, state.status])

	if (state.status === 'ready') {
		return <SettingsClient key={state.version} user={state.account} initialTab={initialTab} pages={state.pages} />
	}
	if (state.status === 'error') {
		return <p className={styles.message} role="alert">Settings could not be loaded. Close settings and try again.</p>
	}
	if (state.status === 'signed-out') {
		return <p className={styles.message} role="status">Sign in to view settings.</p>
	}
	return <p className={styles.message} role="status">Loading settings…</p>
}
