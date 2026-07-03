'use client'

import { useState, useEffect } from 'react'
import { X, Copy, Mail, Globe, Lock } from 'lucide-react'
import { fetchDocumentDetails, createInvitation, updateDocumentPublicStatus } from '@/services/db'

interface ShareModalProps {
	isOpen: boolean
	onClose: () => void
	documentId: string
	documentTitle: string
	userId: string
}

export default function ShareModal ({
	isOpen,
	onClose,
	documentId,
	documentTitle,
	userId,
}: ShareModalProps) {
	const [email, setEmail] = useState('')
	const [role, setRole] = useState<'editor' | 'viewer'>('editor')
	const [isPublic, setIsPublic] = useState(false)
	const [loading, setLoading] = useState(false)
	const [inviteLink, setInviteLink] = useState<string | null>(null)

	useEffect(() => {
		if (isOpen) {
			fetchDocPublicState()
		}
	}, [isOpen, documentId])

	const fetchDocPublicState = async () => {
		try {
			const data = await fetchDocumentDetails(documentId)
			setIsPublic(data.is_public)
		} catch (err) {
			console.error('Error fetching doc public state:', err)
		}
	}

	const handleInvite = async (e: React.FormEvent) => {
		e.preventDefault()
		setLoading(true)
		setInviteLink(null)

		try {
			const token = crypto.randomUUID()
			await createInvitation(documentId, userId, email, role, token)

			// Generate the direct link
			const generatedLink = `${window.location.origin}/invite/${token}`
			setInviteLink(generatedLink)
			setEmail('')
			alert(`Invitation sent for ${email}!`)
		} catch (err: any) {
			alert(`Failed to send invite: ${err.message}`)
		} finally {
			setLoading(false)
		}
	}

	const handleTogglePublic = async () => {
		const nextState = !isPublic
		setIsPublic(nextState)

		try {
			await updateDocumentPublicStatus(documentId, nextState)
		} catch (err: any) {
			setIsPublic(!nextState)
			alert(`Failed to change privacy settings: ${err.message}`)
		}
	}

	const handleCopyLink = () => {
		if (inviteLink) {
			navigator.clipboard.writeText(inviteLink)
			alert('Invitation link copied to clipboard!')
		}
	}

	if (!isOpen) {
		return null
	}

	// Prepare Mailto details
	const mailtoSubject = encodeURIComponent(`Collab Document Invite: ${documentTitle}`)
	const mailtoBody = encodeURIComponent(
		`Hi!\n\nI would like to invite you to collaborate on my document "${documentTitle}" as an ${role}.\n\nClick the link below to accept this invitation:\n${inviteLink || ''}\n\nCheers!`
	)

	return (
		<div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4'>
			<div className='w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200'>
				<div className='flex items-center justify-between border-b border-white/5 pb-4 mb-6'>
					<h3 className='text-xl font-bold text-white'>Share Document</h3>
					<button
						onClick={onClose}
						className='rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition'
					>
						<X className='h-5 w-5' />
					</button>
				</div>

				{/* 1. Public Link Toggle */}
				<div className='mb-6 rounded-xl border border-white/5 bg-slate-950/40 p-4 flex items-center justify-between'>
					<div className='flex items-start gap-3'>
						{isPublic ? (
							<Globe className='h-5 w-5 text-indigo-400 mt-0.5' />
						) : (
							<Lock className='h-5 w-5 text-slate-400 mt-0.5' />
						)}
						<div>
							<p className='text-sm font-semibold text-white'>Anyone with the link can view</p>
							<p className='text-xs text-slate-400 mt-0.5'>
								{isPublic ? 'Document is visible to anyone without sign in' : 'Only invited collaborators can access'}
							</p>
						</div>
					</div>
					<button
						onClick={handleTogglePublic}
						className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${isPublic ? 'bg-indigo-600' : 'bg-slate-700'}`}
					>
						<span
							className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${isPublic ? 'translate-x-6' : 'translate-x-1'}`}
						/>
					</button>
				</div>

				{/* 2. Invite Form */}
				<form onSubmit={handleInvite} className='space-y-4'>
					<div className='flex flex-col sm:flex-row gap-3'>
						<div className='flex-1'>
							<label className='block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1'>
								Invite by Email
							</label>
							<input
								type='email'
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								className='w-full rounded-lg border border-slate-700 bg-slate-800/40 p-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none text-sm'
								placeholder='collaborator@example.com'
								required
							/>
						</div>
						<div className='w-full sm:w-[120px]'>
							<label className='block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1'>
								Role
							</label>
							<select
								value={role}
								onChange={(e) => setRole(e.target.value as any)}
								className='w-full rounded-lg border border-slate-700 bg-slate-800/40 p-2 text-white focus:border-indigo-500 focus:outline-none text-sm'
							>
								<option value='editor'>Editor</option>
								<option value='viewer'>Viewer</option>
							</select>
						</div>
					</div>

					<button
						type='submit'
						disabled={loading}
						className='w-full rounded-lg bg-indigo-600 p-2 font-semibold text-white transition hover:bg-indigo-500 active:scale-95 disabled:opacity-50 text-sm'
					>
						{loading ? 'Sending invite...' : 'Send Invitation'}
					</button>
				</form>

				{/* 3. Generated Token Link Output */}
				{inviteLink && (
					<div className='mt-6 border-t border-white/5 pt-6 space-y-3'>
						<p className='text-xs font-bold uppercase tracking-wider text-slate-400'>
							Invitation Generated
						</p>
						<div className='flex items-center gap-2 rounded-lg bg-slate-950/60 p-2 border border-white/5'>
							<input
								type='text'
								value={inviteLink}
								readOnly
								className='flex-1 bg-transparent text-xs text-indigo-300 focus:outline-none truncate select-all'
							/>
							<button
								onClick={handleCopyLink}
								className='rounded-md bg-slate-800 p-1.5 hover:bg-slate-700 text-slate-300 transition'
								title='Copy link'
							>
								<Copy className='h-4 w-4' />
							</button>
							<a
								href={`mailto:?subject=${mailtoSubject}&body=${mailtoBody}`}
								className='rounded-md bg-slate-800 p-1.5 hover:bg-slate-700 text-slate-300 transition flex items-center justify-center'
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
