'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface InviteDetails {
	id: string
	document_id: string
	role: 'editor' | 'viewer'
	status: 'pending' | 'accepted' | 'declined'
	documents: {
		title: string
	}
	profiles: {
		email: string
		full_name: string | null
	}
}

export default function InvitePage ({
	params,
}: {
	params: { token: string }
}) {
	const router = useRouter()
	const [user, setUser] = useState<any | null>(null)
	const [invite, setInvite] = useState<InviteDetails | null>(null)
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
					alert('Please log in or sign up to accept this invitation')
					router.push('/login')
					return
				}

				setUser(session.user)

				// 2. Fetch invitation details
				const { data, error } = await supabase
					.from('document_invitations')
					.select(`
						id,
						document_id,
						role,
						status,
						documents (title),
						profiles:inviter_id (email, full_name)
					`)
					.eq('token', params.token)
					.single()

				if (error || !data) {
					console.error('Invite load error:', error)
					alert('Invalid or expired invitation link')
					router.push('/')
					return
				}

				const invitation = data as any as InviteDetails

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
			// 1. Add user to document_members
			const { error: memberError } = await supabase
				.from('document_members')
				.insert({
					document_id: invite.document_id,
					user_id: user.id,
					role: invite.role,
				})

			if (memberError && !memberError.message.includes('duplicate key')) {
				// If they are already a member, we ignore duplicate key error
				throw memberError
			}

			// 2. Update status in document_invitations
			const { error: inviteError } = await supabase
				.from('document_invitations')
				.update({ status: 'accepted' })
				.eq('id', invite.id)

			if (inviteError) {
				throw inviteError
			}

			router.push(`/doc/${invite.document_id}`)
		} catch (err: any) {
			alert(`Failed to accept: ${err.message}`)
			setProcessing(false)
		}
	}

	const handleDecline = async () => {
		if (!invite) {
			return
		}
		setProcessing(true)

		try {
			const { error } = await supabase
				.from('document_invitations')
				.update({ status: 'declined' })
				.eq('id', invite.id)

			if (error) {
				throw error
			}

			router.push('/')
		} catch (err: any) {
			alert(`Failed to decline: ${err.message}`)
			setProcessing(false)
		}
	}

	if (loading) {
		return (
			<div className='flex min-h-screen items-center justify-center bg-slate-950 text-white'>
				<div className='flex flex-col items-center gap-3'>
					<span className='h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent' />
					<p className='text-sm text-slate-400 font-semibold'>Verifying invitation link...</p>
				</div>
			</div>
		)
	}

	if (!invite) {
		return null
	}

	return (
		<div className='flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-black p-4'>
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
					<span className='inline-block rounded-full bg-indigo-950 border border-indigo-500/30 px-3 py-0.5 text-xs font-semibold text-indigo-400 capitalize'>
						{invite.role}
					</span>
				</div>

				<div className='flex flex-col sm:flex-row gap-3'>
					<button
						onClick={handleAccept}
						disabled={processing}
						className='flex-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white transition hover:bg-indigo-500 active:scale-95 disabled:opacity-50 text-sm'
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
