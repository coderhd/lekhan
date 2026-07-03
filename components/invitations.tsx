'use client'

import { useState, useEffect } from 'react'
import { DocumentInvitation } from '@/types'
import { fetchPendingInvitations, acceptInvitation, declineInvitation } from '@/services/db'

interface InvitationsProps {
	userEmail: string
	userId: string
	onRefresh: () => void
}

export default function Invitations ({
	userEmail,
	userId,
	onRefresh,
}: InvitationsProps) {
	const [invites, setInvites] = useState<DocumentInvitation[]>([])
	const [loading, setLoading] = useState(true)

	const fetchInvitations = async () => {
		try {
			const data = await fetchPendingInvitations(userEmail)
			setInvites(data)
		} catch (err) {
			console.error('Error fetching invitations:', err)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		if (userEmail) {
			fetchInvitations()
		}
	}, [userEmail])

	const handleAccept = async (invite: DocumentInvitation) => {
		try {
			await acceptInvitation(invite, userId)
			alert('Invitation accepted!')
			fetchInvitations()
			onRefresh()
		} catch (err: any) {
			alert(`Failed to accept: ${err.message}`)
		}
	}

	const handleDecline = async (inviteId: string) => {
		try {
			await declineInvitation(inviteId)
			alert('Invitation declined')
			fetchInvitations()
		} catch (err: any) {
			alert(`Failed to decline: ${err.message}`)
		}
	}

	if (loading) {
		return <div className='text-sm text-slate-400'>Loading invitations...</div>
	}

	if (invites.length === 0) {
		return null
	}

	return (
		<div className='mb-8 rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-6 backdrop-blur-md'>
			<h3 className='mb-4 text-lg font-semibold text-indigo-200 flex items-center gap-2'>
				<span className='flex h-2 w-2 rounded-full bg-indigo-400 animate-pulse' />
				Pending Invitations ({invites.length})
			</h3>
			<div className='space-y-3'>
				{invites.map((invite) => (
					<div
						key={invite.id}
						className='flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg bg-slate-900/40 p-4 border border-white/5'
					>
						<div>
							<p className='text-sm font-medium text-white'>
								Invitation to join{' '}
								<span className='font-bold text-indigo-300'>
									{invite.documents?.title || 'Untitled'}
								</span>{' '}
								as <span className='capitalize font-bold'>{invite.role}</span>
							</p>
							<p className='text-xs text-slate-400 mt-1'>
								Invited by:{' '}
								{invite.profiles?.full_name || invite.profiles?.email}
							</p>
						</div>
						<div className='flex items-center gap-2'>
							<button
								onClick={() => handleAccept(invite)}
								className='rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500'
							>
								Accept
							</button>
							<button
								onClick={() => handleDecline(invite.id)}
								className='rounded-md bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-300 border border-slate-700 transition hover:bg-slate-700'
							>
								Decline
							</button>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
