'use client'

import { use, useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PageInvitation } from '@/types'
import { fetchPageInvitationDetails, acceptPageInvitation, declinePageInvitation } from '@/services/graph'
import GlobalLoader from '@/components/global-loader'
import AccessFrame from '@/components/workbench/access-frame'
import Link from 'next/link'
import { toast } from 'sonner'

export default function InvitePage ({
	params: paramsPromise,
}: {
	params: Promise<{ token: string }>
}) {
	const params = use(paramsPromise)
	const router = useRouter()
	const [error, setError] = useState<string | null>(null)
	const [unavailable, setUnavailable] = useState(false)
	const [reload, setReload] = useState(0)
	const busyRef = useRef(false)
	const [user, setUser] = useState<any | null>(null)
	const [invite, setInvite] = useState<PageInvitation | null>(null)
	const [loading, setLoading] = useState(true)
	const [processing, setProcessing] = useState(false)

	useEffect(() => {
		let current = true
		setLoading(true)
		setError(null)
		const checkUserAndInvite = async () => {
			try {
				// 1. Get current session
				const { data: { session } } = await supabase.auth.getSession()
				if (!current) return
				if (!session) {
					// Save token in cookie and redirect to login
					document.cookie = `pending_invite_token=${params.token}; path=/; max-age=3600`
					toast.error('Please log in or sign up to accept this invitation')
					router.push('/login')
					return
				}

				setUser(session.user)

				// 2. Fetch invitation details
				const invitation = await fetchPageInvitationDetails(params.token)
				if (!current) return

				if (invitation.status === 'accepted') {
					router.push(`/page/${invitation.page_id}`)
					return
				}

				if (invitation.status !== 'pending') {
					setUnavailable(true)
					return
				}

				setInvite(invitation)
			} catch (err) {
				if (!current) return
				console.error('Unexpected error loading invite page:', err)
				setError('Could not load this invitation. Please try again.')
			} finally {
				if (current) setLoading(false)
			}
		}

		checkUserAndInvite()
		return () => { current = false }
	}, [params.token, router, reload])

	const handleAccept = async () => {
		if (!invite || !user || busyRef.current) {
			return
		}
		busyRef.current = true
		setError(null)
		setProcessing(true)

		try {
			await acceptPageInvitation(invite, user.id)
			router.push(`/page/${invite.page_id}`)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			setError(`Failed to accept: ${message}`)
			toast.error(`Failed to accept: ${message}`)
			busyRef.current = false
			setProcessing(false)
		}
	}

	const handleDecline = async () => {
		if (!invite || busyRef.current) {
			return
		}
		busyRef.current = true
		setError(null)
		setProcessing(true)

		try {
			await declinePageInvitation(invite.id)
			router.push('/')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			setError(`Failed to decline: ${message}`)
			toast.error(`Failed to decline: ${message}`)
			busyRef.current = false
			setProcessing(false)
		}
	}

	if (loading) {
		return <GlobalLoader text="Processing invitation..." />
	}

	if (!invite || unavailable) {
		return <AccessFrame><h1>Page invitation</h1><div role="alert" className="my-6 text-sm text-on-surface-variant">
			{unavailable ? 'This invitation is no longer available. Ask the page owner for a current invitation.' : error ?? 'Sign in to review this invitation.'}
		</div>{error && <button type="button" onClick={() => setReload(value => value + 1)}>Try again</button>}<Link href="/">Back to workspace</Link></AccessFrame>
	}

	return (
		<AccessFrame>
			<div className="space-y-6">
				<h1>
					Page Invitation
				</h1>
				<p className='text-sm text-on-surface-variant mb-6'>
					You have been invited to join a collaborative page workspace
				</p>

				<div className='rounded-xl bg-surface-container-low border border-outline-variant p-5 mb-6 text-left'>
					<p className='text-xs text-on-surface-variant uppercase tracking-wider font-semibold mb-1'>
						Page Title
					</p>
					<p className='text-lg font-bold text-on-surface mb-4'>
						{invite.pages?.title || 'Untitled'}
					</p>

					<p className='text-xs text-on-surface-variant uppercase tracking-wider font-semibold mb-1'>
						Invited By
					</p>
					<p className='text-sm text-on-surface-variant font-medium mb-4'>
						{invite.profiles?.full_name || invite.profiles?.email}
					</p>

					<p className='text-xs text-on-surface-variant uppercase tracking-wider font-semibold mb-1'>
						Access Role
					</p>
					<span className='inline-block rounded-full bg-primary-container/20 border border-primary-container/30 px-3 py-0.5 text-xs font-semibold text-primary-ink capitalize'>
						{invite.role}
					</span>
				</div>

				{error && <p role="alert" className="text-error">{error}</p>}
				<div className='flex flex-col sm:flex-row gap-3'>
					<button
						onClick={handleAccept}
						disabled={processing}
						className='flex-1 rounded-lg bg-primary-container py-2.5 font-semibold text-on-primary-container transition hover:brightness-110 active:scale-95 disabled:opacity-50 text-sm'
					>
						{processing ? 'Processing...' : 'Accept Invitation'}
					</button>
					<button
						onClick={handleDecline}
						disabled={processing}
						className='flex-1 rounded-lg bg-surface-container py-2.5 font-semibold text-on-surface-variant border border-outline-variant transition hover:bg-surface-container-high active:scale-95 disabled:opacity-50 text-sm'
					>
						Decline
					</button>
				</div>
			</div>
		</AccessFrame>
	)
}
