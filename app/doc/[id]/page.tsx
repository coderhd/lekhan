'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchDocumentDetails } from '@/services/db'
import GlobalLoader from '@/components/global-loader'
import EditorWorkspace from '@/components/editor-workspace'
import { toast } from 'sonner'

export default function DocumentPage ({
	params: paramsPromise,
}: {
	params: Promise<{ id: string }>
}) {
	const params = use(paramsPromise)
	const router = useRouter()
	const [user, setUser] = useState<any | null>(null)
	const [token, setToken] = useState<string | null>(null)
	const [documentTitle, setDocumentTitle] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const loadDocumentAndSession = async () => {
			try {
				// 1. Get current session and token
				const { data: { session } } = await supabase.auth.getSession()
				const { error: userError } = await supabase.auth.getUser()
				
				// If there is an auth error that is NOT just a missing session, it means the token expired or is invalid
				if (userError && userError.name !== 'AuthSessionMissingError') {
					console.error('Session error (token expired):', userError)
					toast.error('Session expired. Please log in again.')
					router.push('/login')
					return
				}

				if (session) {
					setUser(session.user)
					setToken(session.access_token)
				} else {
					// Check if document is public
					try {
						const doc = await fetchDocumentDetails(params.id)
						if (doc && doc.is_public) {
							// Mock anonymous user
							const randomId = Math.random().toString(36).substring(7)
							setUser({
								id: `anon-${randomId}`,
								email: 'anonymous@public',
								full_name: 'Anonymous Viewer'
							})
							setToken('anonymous')
						} else {
							router.push('/login')
							return
						}
					} catch {
						router.push('/login')
						return
					}
				}

				// 2. Fetch document details using wrapper service
				const doc = await fetchDocumentDetails(params.id)
				setDocumentTitle(doc.title)
			} catch (err: unknown) {

				console.error('Error loading document page:', err)
				toast.error('Document not found or access denied')
				router.push('/')
			} finally {
				setLoading(false)
			}
		}

		loadDocumentAndSession()
	}, [params.id, router])

	if (loading) {
		return <GlobalLoader text="Loading document..." />
	}

	if (!user || !token || !documentTitle) {
		return null
	}

	return (
		<EditorWorkspace
			documentId={params.id}
			initialTitle={documentTitle}
			token={token}
			currentUser={{
				id: user.id,
				email: user.email,
				full_name: user.user_metadata?.full_name || user.full_name
			}}
		/>
	)
}
