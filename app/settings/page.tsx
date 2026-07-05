'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import GlobalLoader from '@/components/global-loader'
import SettingsClient from '@/components/settings-client'
import { fetchOwnedDocumentsWithMembers } from '@/services/db'

export default function SettingsPage() {
	const router = useRouter()
	const [user, setUser] = useState<any | null>(null)
	const [documents, setDocuments] = useState<any[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const init = async () => {
			try {
				const { data: { user: sessionUser } } = await supabase.auth.getUser()
				if (!sessionUser) {
					router.push('/login')
					return
				}
				setUser(sessionUser)
				const docs = await fetchOwnedDocumentsWithMembers(sessionUser.id)
				setDocuments(docs)
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

	return <SettingsClient user={user} documents={documents} setDocuments={setDocuments} />
}
