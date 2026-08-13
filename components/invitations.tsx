'use client'

import { useState, useEffect } from 'react'
import { PageInvitation } from '@/types'
import { fetchPendingPageInvitations, acceptPageInvitation, declinePageInvitation } from '@/services/graph'
import GlobalLoader from './global-loader'
import { toast } from 'sonner'

interface InvitationsProps {
	userEmail: string
	userId: string
	onRefresh: () => void
	variant?: 'default' | 'dropdown'
}

export default function Invitations({
	userEmail,
	userId,
	onRefresh,
	variant = 'default'
}: InvitationsProps) {
	const [invites, setInvites] = useState<PageInvitation[]>([])
	const [loading, setLoading] = useState(true)

	const fetchInvitations = async () => {
		try {
			const data = await fetchPendingPageInvitations(userEmail)
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

	const handleAccept = async (invite: PageInvitation) => {
		try {
			await acceptPageInvitation(invite, userId)
			toast.success('Invitation accepted!')
			fetchInvitations()
			onRefresh()
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to accept: ${message}`)
		}
	}

	const handleDecline = async (inviteId: string) => {
		try {
			await declinePageInvitation(inviteId)
			toast.success('Invitation declined')
			fetchInvitations()
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to decline: ${message}`)
		}
	}

	if (loading) {
		return <div className="p-4 flex justify-center"><GlobalLoader fullScreen={false} text="" size="sm" /></div>
	}

	if (invites.length === 0) {
		return variant === 'dropdown' ? (
			<div className="p-8 flex flex-col items-center justify-center text-center opacity-0 animate-fade-in-up">
				<img src="/undraw_empty-mailbox_ef0e.svg" alt="No notifications" className="w-32 h-32 mb-4 opacity-90 drop-shadow-sm" />
				<p className="text-sm font-semibold text-on-surface mb-1">You're all caught up!</p>
				<p className="text-xs text-on-surface-variant">No new notifications.</p>
			</div>
		) : null
	}

	if (variant === 'dropdown') {
		return (
			<div className="max-h-96 overflow-y-auto">
				{invites.map((invite) => (
					<div key={invite.id} className="p-4 border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
						<p className='text-sm text-on-surface'>
							<span className='font-semibold'>{invite.profiles?.full_name || invite.profiles?.email}</span> invited you to edit <span className='font-semibold'>"{invite.pages?.title || 'Untitled'}"</span>
						</p>
						<div className='flex items-center gap-2 mt-3'>
							<button onClick={() => handleAccept(invite)} className='bg-primary-container text-on-primary-container text-xs font-bold px-3 py-1.5 rounded-md hover:brightness-110 active:scale-95 transition-all'>Accept</button>
							<button onClick={() => handleDecline(invite.id)} className='bg-surface text-on-surface border border-black/10 dark:border-white/10 text-xs font-bold px-3 py-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition-all'>Decline</button>
						</div>
					</div>
				))}
			</div>
		)
	}

	return (
		<div className='mb-8 rounded-2xl border border-black/10 dark:border-white/10 bg-surface-container p-6 shadow-sm'>
			<h3 className='mb-4 text-lg font-semibold text-primary-container flex items-center gap-2'>
				<span className='flex h-2 w-2 rounded-full bg-primary-container animate-pulse' />
				Pending Invitations ({invites.length})
			</h3>
			<div className='space-y-0'>
				{invites.map((invite) => (
					<div
						key={invite.id}
						className='flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 border-b border-black/5 dark:border-white/5 last:border-0'
					>
						<div>
							<p className='text-sm font-medium text-on-surface'>
								Invitation to join{' '}
								<span className='font-bold text-primary-container'>
									{invite.pages?.title || 'Untitled'}
								</span>{' '}
								as <span className='capitalize font-bold'>{invite.role}</span>
							</p>
							<p className='text-xs text-on-surface-variant mt-1'>
								Invited by:{' '}
								{invite.profiles?.full_name || invite.profiles?.email}
							</p>
						</div>
						<div className='flex items-center gap-2'>
							<button
								onClick={() => handleAccept(invite)}
								className='rounded-lg bg-primary-container px-4 py-2 text-xs font-bold text-on-primary-container transition hover:brightness-110 active:scale-95 shadow-sm'
							>
								Accept
							</button>
							<button
								onClick={() => handleDecline(invite.id)}
								className='rounded-lg bg-transparent px-4 py-2 text-xs font-bold text-on-surface-variant border border-black/20 dark:border-white/20 transition hover:bg-black/5 dark:hover:bg-white/5 active:scale-95'
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
