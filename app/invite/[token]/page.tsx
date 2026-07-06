'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { DocumentInvitation } from '@/types'
import { fetchInvitationDetails, acceptInvitation, declineInvitation } from '@/services/db'
import GlobalLoader from '@/components/global-loader'
import { toast } from 'sonner'

export default function InvitePage ({
	params: paramsPromise,
}: {
	params: Promise<{ token: string }>
}) {
	const params = use(paramsPromise)
	const router = useRouter()
	const [user, setUser] = useState<any | null>(null)
	const [invite, setInvite] = useState<DocumentInvitation | null>(null)
	const [loading, setLoading] = useState(true)
	const [processing, setProcessing] = useState(false)

	useEffect(() => {
		const checkUserAndInvite = async () => {
			try {
				// 1. Get current session
				const { data: { session } } = await supabase.auth.getSession()
				if (!session) {
					// Save token in cookie and redirect to login
					document.cookie = `pending_invite_token=${params.token}; path=/; max-age=3600`
					toast.error('Please log in or sign up to accept this invitation')
					router.push('/login')
					return
				}

				setUser(session.user)

				// 2. Fetch invitation details
				const invitation = await fetchInvitationDetails(params.token)

				if (invitation.status === 'accepted') {
					router.push(`/doc/${invitation.document_id}`)
					return
				}

				setInvite(invitation)
			} catch (err) {
				console.error('Unexpected error loading invite page:', err)
				router.push('/')
			} finally {
				setLoading(false)
			}
		}

		checkUserAndInvite()
	}, [params.token, router])

	const handleAccept = async () => {
		if (!invite || !user) {
			return
		}
		setProcessing(true)

		try {
			await acceptInvitation(invite, user.id)
			router.push(`/doc/${invite.document_id}`)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to accept: ${message}`)
			setProcessing(false)
		}
	}

	const handleDecline = async () => {
		if (!invite) {
			return
		}
		setProcessing(true)

		try {
			await declineInvitation(invite.id)
			router.push('/')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to decline: ${message}`)
			setProcessing(false)
		}
	}

	if (loading) {
		return <GlobalLoader text="Processing invitation..." />
	}

	if (!invite) {
		return null
	}

	return (
		<div className='flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black p-4'>
			<div className='w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/60 p-8 backdrop-blur-xl shadow-2xl text-center'>
				<h2 className='text-2xl font-bold tracking-tight text-white mb-2'>
					Document Invitation
				</h2>
				<p className='text-sm text-slate-400 mb-6'>
					You have been invited to join a collaborative document workspace
				</p>

				<div className='rounded-xl bg-slate-950/60 border border-white/5 p-5 mb-6 text-left'>
					<p className='text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1'>
						Document Title
					</p>
					<p className='text-lg font-bold text-white mb-4'>
						{invite.documents?.title || 'Untitled'}
					</p>

					<p className='text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1'>
						Invited By
					</p>
					<p className='text-sm text-slate-300 font-medium mb-4'>
						{invite.profiles?.full_name || invite.profiles?.email}
					</p>

					<p className='text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1'>
						Access Role
					</p>
					<span className='inline-block rounded-full bg-orange-500/20 border border-orange-500/30 px-3 py-0.5 text-xs font-semibold text-orange-300 capitalize'>
						{invite.role}
					</span>
				</div>

				<div className='flex flex-col sm:flex-row gap-3'>
					<button
						onClick={handleAccept}
						disabled={processing}
						className='flex-1 rounded-lg bg-orange-500 py-2.5 font-semibold text-black transition hover:bg-orange-400 active:scale-95 disabled:opacity-50 text-sm'
					>
						{processing ? 'Processing...' : 'Accept Invitation'}
					</button>
					<button
						onClick={handleDecline}
						disabled={processing}
						className='flex-1 rounded-lg bg-slate-800 py-2.5 font-semibold text-slate-300 border border-slate-700 transition hover:bg-slate-700 active:scale-95 disabled:opacity-50 text-sm'
					>
						Decline
					</button>
				</div>
			</div>
		</div>
	)
}
