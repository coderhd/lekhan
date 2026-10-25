'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchPageDetails } from '@/services/graph'
import { consumePendingImport } from '@/services/import'
import GlobalLoader from '@/components/global-loader'
import EditorWorkspace from '@/components/editor-workspace'
import PublicAccessDenied from '@/components/public-access-denied'
import { toast } from 'sonner'

export default function PageRoute({
	params: paramsPromise,
}: {
	params: Promise<{ id: string }>
}) {
	const params = use(paramsPromise)
	const router = useRouter()
	const [user, setUser] = useState<any | null>(null)
	const [token, setToken] = useState<string | null>(null)
	const [pageTitle, setPageTitle] = useState<string | null>(null)
	const [initialContent, setInitialContent] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	// True once the signed-out public path granted a synthetic anonymous
	// session; drives the public reading chrome (badge, footer CTA, reduced
	// header) inside the workspace. `isViewer` alone cannot express this — a
	// member with viewer role is a different experience.
	const [isAnon, setIsAnon] = useState(false)
	// Inline access-denied screen state; the old behaviour silently bounced to
	// /login with no explanation for unshared or missing pages.
	const [denied, setDenied] = useState<'public' | 'internal' | null>(null)

	useEffect(() => {
		let cancelled = false
		const loadPageAndSession = async () => {
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

				// 2. Fetch page details once and reuse the result for both the
				// public-page validation and the page title state.
				let page: Awaited<ReturnType<typeof fetchPageDetails>> | null = null
				if (session) {
					if (cancelled) return
					setUser(session.user)
					setToken(session.access_token)
					page = await fetchPageDetails(params.id)
				} else {
					// Check if page is public
					try {
						page = await fetchPageDetails(params.id)
						if (page && page.is_public) {
							if (cancelled) return
							setUser({
								id: `anon-${crypto.randomUUID()}`,
								email: 'anonymous@public',
								full_name: 'Anonymous Viewer'
							})
							setToken('anonymous')
							setIsAnon(true)
						} else {
							if (!cancelled) setDenied('public')
							return
						}
					} catch {
						if (!cancelled) setDenied('public')
						return
					}
				}

				if (cancelled) return
				setPageTitle(page.title)
				// A pending import payload (markdown body) is consumed here, on
				// the page route, and passed to the workspace for first-open
				// hydration. `consumePendingImport` is read-and-delete, so a
				// refresh or re-mount of this route finds nothing pending.
				setInitialContent(consumePendingImport(params.id))
			} catch (err: unknown) {
				console.error('Error loading page:', err)
				if (!cancelled) setDenied('internal')
			} finally {
				if (!cancelled) {
					setLoading(false)
				}
			}
		}

		loadPageAndSession()
		return () => {
			cancelled = true
		}
	}, [params.id, router])

	if (loading) {
		return <GlobalLoader text="Loading page..." />
	}

	if (denied) {
		return <PublicAccessDenied variant={denied} />
	}

	if (!user || !token || pageTitle === null) {
		return null
	}

	return (
		<EditorWorkspace
			pageId={params.id}
			initialTitle={pageTitle}
			initialContent={initialContent}
			token={token}
			currentUser={{
				id: user.id,
				email: user.email,
				full_name: user.user_metadata?.full_name || user.full_name
			}}
			anonVisitor={isAnon}
		/>
	)
}
