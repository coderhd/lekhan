'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchDocumentDetails } from '@/services/db'
import EditorWorkspace from '@/components/editor-workspace'

export default function DocumentPage ({
	params,
}: {
	params: { id: string }
}) {
	const router = useRouter()
	const [user, setUser] = useState<any | null>(null)
	const [token, setToken] = useState<string | null>(null)
	const [documentTitle, setDocumentTitle] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const loadDocumentAndSession = async () => {
			try {
				// 1. Get current session and token
				const { data: { session }, error: sessionError } = await supabase.auth.getSession()
				if (sessionError || !session) {
					router.push('/login')
					return
				}

				setUser(session.user)
				setToken(session.access_token)

				// 2. Fetch document details using wrapper service
				const doc = await fetchDocumentDetails(params.id)
				setDocumentTitle(doc.title)
			} catch (err: any) {
				console.error('Error loading document page:', err)
				alert('Document not found or access denied')
				router.push('/')
			} finally {
				setLoading(false)
			}
		}

		loadDocumentAndSession()
	}, [params.id, router])

	if (loading) {
		return (
			<div className='flex min-h-screen items-center justify-center bg-slate-950 text-white'>
				<div className='flex flex-col items-center gap-3'>
					<span className='h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent' />
					<p className='text-sm text-slate-400 font-semibold'>Opening document...</p>
				</div>
			</div>
		)
	}

	if (!user || !token || !documentTitle) {
		return null
	}

	return (
		<EditorWorkspace
			documentId={params.id}
			initialTitle={documentTitle}
			token={token}
			currentUser={user}
		/>
	)
}
