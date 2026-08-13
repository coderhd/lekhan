'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import GlobalLoader from '@/components/global-loader'
import SettingsClient from '@/components/settings-client'
import { fetchOwnedPagesWithMembers } from '@/services/graph'

export default function SettingsPage() {
	const router = useRouter()
	const [user, setUser] = useState<any | null>(null)
	const [pages, setPages] = useState<any[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const init = async () => {
			try {
				const { data: { user: sessionUser } } = await supabase.auth.getUser()
				if (!sessionUser) {
					router.push('/login')
					return
				}
				setUser({
					id: sessionUser.id,
					email: sessionUser.email,
					full_name: sessionUser.user_metadata?.full_name
				})
				const pages = await fetchOwnedPagesWithMembers(sessionUser.id)
				setPages(pages)
			} catch (err) {
				console.error(err)
				router.push('/login')
			} finally {
				setLoading(false)
			}
		}
		init()
	}, [router])

	if (loading) return <GlobalLoader text="Loading Settings..." />
	if (!user) return null

	return <SettingsClient user={user} pages={pages} setPages={setPages} />
}
