'use client'

import { useState, useEffect } from 'react'
import { X, Copy, Mail, Globe, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { fetchPageDetails, updatePagePublicStatus, createPageInvitation, fetchPageMembers, removePageMember, updatePageMemberRole } from '@/services/graph'
import { fetchPastCollaborators } from '@/services/db'
import { PageMember } from '@/types'
import { CustomSelect } from './ui/custom-select'
import { track } from '@/lib/analytics'

interface ShareModalProps {
	isOpen: boolean
	onClose: () => void
	documentId: string
	documentTitle: string
	userId: string
	isOwner: boolean
}

export default function ShareModal({
	isOpen,
	onClose,
	documentId,
	documentTitle,
	userId,
	isOwner,
}: ShareModalProps) {
	const [email, setEmail] = useState('')
	const [role, setRole] = useState<'editor' | 'viewer'>('editor')
	const [isPublic, setIsPublic] = useState(false)
	const [loading, setLoading] = useState(false)
	const [inviteLink, setInviteLink] = useState<string | null>(null)
	const [pastCollaborators, setPastCollaborators] = useState<{email: string; full_name: string}[]>([])
	const [members, setMembers] = useState<PageMember[]>([])
	const [membersLoading, setMembersLoading] = useState(false)

	useEffect(() => {
		if (!isOpen) return

		let cancelled = false
		setMembersLoading(true)

		const load = async () => {
			try {
				const data = await fetchPageDetails(documentId)
				if (cancelled) return
				setIsPublic(data.is_public)
			} catch (err) {
				console.error('Error fetching doc public state:', err)
			}
			try {
				const collabs = await fetchPastCollaborators(userId)
				if (cancelled) return
				setPastCollaborators(collabs)
			} catch (err) {
				console.error('Error fetching past collaborators:', err)
			}
			try {
				const memberData = await fetchPageMembers(documentId)
				if (cancelled) return
				setMembers(memberData)
			} catch (err) {
				console.error('Error fetching page members:', err)
			} finally {
				if (!cancelled) {
					setMembersLoading(false)
				}
			}
		}

		load()

		return () => {
			cancelled = true
		}
	}, [isOpen, documentId, userId])

	const handleRemoveMember = async (member: PageMember) => {
		try {
			await removePageMember(documentId, member.user_id)
			setMembers(prev => prev.filter(m => m.user_id !== member.user_id))
			toast.success('Member removed')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to remove member: ${message}`)
		}
	}

	const handleRoleChange = async (member: PageMember, role: 'editor' | 'viewer') => {
		try {
			await updatePageMemberRole(documentId, member.user_id, role)
			setMembers(prev => prev.map(m => m.user_id === member.user_id ? { ...m, role } : m))
			toast.success('Role updated')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to update role: ${message}`)
		}
	}

	const handleInvite = async (e: React.FormEvent) => {
		e.preventDefault()
		setLoading(true)
		setInviteLink(null)

		try {
			const token = crypto.randomUUID()
			await createPageInvitation(documentId, userId, email, role, token)

			// Generate the direct link
			const generatedLink = `${window.location.origin}/invite/${token}`
			setInviteLink(generatedLink)
			setEmail('')
			toast.success(`Invite link generated for ${email}!`)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			if (message.toLowerCase().includes('collaborator limit') || message.toLowerCase().includes('upgrade plan')) {
				track('paywall_hit', { gate: 'collaborators' })
			}
			toast.error(`Failed to send invite: ${message}`)
		} finally {
			setLoading(false)
		}
	}

	const handleTogglePublic = async () => {
		const nextState = !isPublic
		setIsPublic(nextState)

		try {
			await updatePagePublicStatus(documentId, nextState)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			setIsPublic(!nextState)
			toast.error(`Failed to change privacy settings: ${message}`)
		}
	}

	const handleCopyLink = () => {
		if (inviteLink) {
			navigator.clipboard.writeText(inviteLink)
			toast.success('Invitation link copied to clipboard!')
		}
	}

	if (!isOpen) {
		return null
	}

	// Prepare Mailto details
	const mailtoSubject = encodeURIComponent(`Collab Document Invite: ${documentTitle}`)
	const mailtoBody = encodeURIComponent(
		`Hi there!\n\nYou've been invited to collaborate on "${documentTitle}" in Lekhan.\n\nYour Role: ${role}\n\nClick the link below to accept this invitation:\n${inviteLink || ''}\n\n---\nLekhan - The Collaborative Editor`
	)

	return (
		<div className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4'>
			<div className='w-full max-w-lg bg-surface-container-low border border-white/10 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200'>
				<div className='flex items-center justify-between border-b border-white/10 pb-4 mb-6'>
					<h3 className='text-lg font-bold text-on-surface'>Share Page</h3>
					<button
						onClick={onClose}
						className='rounded-lg p-1.5 text-on-surface-variant hover:bg-white/10 hover:text-on-surface transition'
					>
						<X className='h-5 w-5' />
					</button>
				</div>

				{/* 1. Public Link Toggle */}
				<div className='mb-6 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 flex flex-col'>
					<div className='flex items-center justify-between'>
						<div className='flex items-start gap-3'>
							{isPublic ? (
								<Globe className='h-5 w-5 text-primary-container mt-0.5' />
							) : (
								<Lock className='h-5 w-5 text-on-surface-variant/60 mt-0.5' />
							)}
							<div>
								<p className='text-sm font-semibold text-on-surface'>Anyone with the link can view</p>
								<p className='text-xs text-on-surface-variant/60 mt-0.5'>
									{isPublic ? 'Document is visible to anyone without sign in' : 'Only invited collaborators can access'}
								</p>
							</div>
						</div>
						<button
							onClick={handleTogglePublic}
							className={`relative inline-flex h-6 w-11 shrink-0 ml-2 items-center rounded-full border transition-colors duration-200 focus:outline-none ${isPublic ? 'bg-primary-container border-primary-container' : 'bg-black/10 dark:bg-transparent border-black/20 dark:border-white/20'}`}
						>
							<span
								className={`inline-block h-4 w-4 transform rounded-full transition-transform duration-200 ${isPublic ? 'translate-x-6 bg-white' : 'translate-x-1 bg-black/40 dark:bg-white/40'}`}
							/>
						</button>
					</div>
					
					{isPublic && (
						<div className='mt-4 pt-4 border-t border-black/10 dark:border-white/10 flex items-center gap-2'>
							<input
								type='text'
								value={`${typeof window !== 'undefined' ? window.location.origin : ''}/page/${documentId}`}
								readOnly
								className='flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 text-xs text-on-surface outline-none cursor-text selection:bg-primary-container/30'
							/>
							<button
								onClick={() => {
									navigator.clipboard.writeText(`${typeof window !== 'undefined' ? window.location.origin : ''}/page/${documentId}`);
									toast.success('Public link copied to clipboard!');
								}}
								className='rounded-xl bg-surface-container-high border border-black/10 dark:border-white/10 p-2.5 text-on-surface hover:bg-black/5 dark:hover:bg-white/5 transition'
								title='Copy link'
							>
								<Copy className='h-4 w-4' />
							</button>
						</div>
					)}
				</div>

				{/* 1.5 Members */}
				<div className='mb-6'>
					<p className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-2'>
						Members ({members.length})
					</p>
					{membersLoading ? (
						<p className='text-xs text-on-surface-variant/60 py-2'>Loading members...</p>
					) : members.length === 0 ? (
						<p className='text-xs text-on-surface-variant/60 py-2'>No collaborators added yet.</p>
					) : (
						<ul className='space-y-2 max-h-48 overflow-y-auto pr-1'>
							{members.map((member) => (
								<li
									key={member.user_id}
									className='flex items-center justify-between bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2'
								>
									<div className='flex items-center gap-2 min-w-0'>
										<div className='w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs uppercase shrink-0'>
											{(member.profiles?.full_name || member.profiles?.email || '?').charAt(0)}
										</div>
										<div className='min-w-0'>
											<div className='text-xs font-semibold text-on-surface truncate'>
												{member.profiles?.full_name || member.profiles?.email}
											</div>
											<div className='text-[10px] text-on-surface-variant/70 truncate'>
												{member.profiles?.email}
											</div>
										</div>
									</div>
									<div className='flex items-center gap-2 shrink-0'>
										{isOwner && member.role !== 'owner' ? (
											<CustomSelect
												value={member.role as 'editor' | 'viewer'}
												onValueChange={(val) => handleRoleChange(member, val as 'editor' | 'viewer')}
												options={[
													{ label: 'Editor', value: 'editor' },
													{ label: 'Viewer', value: 'viewer' },
												]}
												triggerClassName='h-7 w-[100px] bg-transparent border border-black/10 dark:border-white/10 rounded-lg text-[10px] font-medium text-on-surface px-2 focus:ring-0'
												contentClassName='w-[100px]'
											/>
										) : (
											<span className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/70 capitalize'>
												{member.role === 'owner' ? 'Owner' : member.role}
											</span>
										)}
										{isOwner && member.role !== 'owner' && (
											<button
												onClick={() => handleRemoveMember(member)}
												className='text-error hover:text-error/80 text-xs font-bold px-2 py-1 border border-error/30 rounded-md hover:bg-error/10 transition-colors'
											>
												Remove
											</button>
										)}
									</div>
								</li>
							))}
						</ul>
					)}
				</div>

				{/* 2. Invite Form */}
				<form onSubmit={handleInvite} className='space-y-4'>
					<div className='flex flex-col sm:flex-row gap-3'>
						<div className='flex-1'>
							<label className='block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1'>
								Invite by Email
							</label>
							<input
								type='email'
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								className='w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:ring-2 focus:ring-primary-container/50 focus:border-primary-container outline-none premium-transition'
								placeholder='collaborator@example.com'
								required
							/>
						</div>
						<div className='w-full sm:w-[120px]'>
							<label className='block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1'>
								Role
							</label>
							<CustomSelect
								value={role}
								onValueChange={(val) => setRole(val as any)}
								options={[
									{ label: 'Editor', value: 'editor' },
									{ label: 'Viewer', value: 'viewer' },
								]}
								triggerClassName='w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 h-[38px] text-xs text-on-surface focus:ring-2 focus:ring-primary-container/50 outline-none premium-transition'
							/>
						</div>
					</div>

					<button
						type='submit'
						disabled={loading}
						className='w-full rounded-xl bg-primary-container text-on-primary-container font-bold py-2.5 text-sm hover:brightness-110 active:scale-95 transition-all shadow-sm'
					>
						{loading ? 'Creating link...' : 'Create Invite Link'}
					</button>
				</form>

				{pastCollaborators.length > 0 && (
					<div className='mt-4 pt-4 border-t border-black/10 dark:border-white/10'>
						<p className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-2'>
							Past Collaborators
						</p>
						<div className='flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10'>
							{pastCollaborators.map((collab) => (
								<button
									key={collab.email}
									onClick={() => setEmail(collab.email)}
									className='flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/10 transition-colors shrink-0'
									title={collab.email}
									type='button'
								>
									<span className='text-xs font-medium text-on-surface'>{collab.full_name}</span>
								</button>
							))}
						</div>
					</div>
				)}

				{/* 3. Generated Token Link Output */}
				{inviteLink && (
					<div className='mt-6 border-t border-white/10 pt-6 space-y-3'>
						<p className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60'>
							Invitation Generated
						</p>
						<div className='flex items-center gap-2 rounded-xl bg-black/5 dark:bg-white/5 p-2 border border-black/10 dark:border-white/10'>
							<input
								type='text'
								value={inviteLink}
								readOnly
								className='flex-1 bg-transparent text-xs text-on-surface-variant focus:outline-none truncate select-all px-1'
							/>
							<button
								onClick={handleCopyLink}
								className='rounded-lg border border-black/10 dark:border-white/10 text-on-surface-variant bg-surface p-1.5 hover:bg-black/5 dark:hover:bg-white/5 hover:text-on-surface transition'
								title='Copy link'
							>
								<Copy className='h-4 w-4' />
							</button>
							<a
								href={`mailto:${email}?subject=${mailtoSubject}&body=${mailtoBody}`}
								className='rounded-lg border border-black/10 dark:border-white/10 text-on-surface-variant bg-surface p-1.5 hover:bg-black/5 dark:hover:bg-white/5 hover:text-on-surface transition flex items-center justify-center'
								title='Share via Email (mailto)'
							>
								<Mail className='h-4 w-4' />
							</a>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
