'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { removeDocumentMember } from '@/services/db'
import Link from 'next/link'
import { toast } from 'sonner'
import ThemeToggle from './theme-toggle'
import ProfileMenu from './profile-menu'

import { DocumentItem } from '@/types'

export default function SettingsClient({ user, documents, setDocuments }: { 
	user: { id: string; email: string; full_name?: string }, 
	documents: any[], 
	setDocuments: React.Dispatch<React.SetStateAction<any[]>> 
}) {
	const router = useRouter()
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [passwordError, setPasswordError] = useState('')
	const [passwordSuccess, setPasswordSuccess] = useState('')
	const [loading, setLoading] = useState(false)
	const [theme, setTheme] = useState<'light' | 'dark'>('dark')

	useEffect(() => {
		if (typeof window !== 'undefined') {
			const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' || 'dark'
			setTheme(savedTheme)
			if (savedTheme === 'dark') {
				document.documentElement.classList.add('dark')
			} else {
				document.documentElement.classList.remove('dark')
			}
		}
	}, [])

	const toggleTheme = () => {
		const nextTheme = theme === 'dark' ? 'light' : 'dark'
		setTheme(nextTheme)
		localStorage.setItem('theme', nextTheme)
		if (nextTheme === 'dark') {
			document.documentElement.classList.add('dark')
		} else {
			document.documentElement.classList.remove('dark')
		}
	}

	const handleChangePassword = async (e: React.FormEvent) => {
		e.preventDefault()
		setPasswordError('')
		setPasswordSuccess('')

		if (password !== confirmPassword) {
			setPasswordError('Passwords do not match')
			return
		}
		if (password.length < 6) {
			setPasswordError('Password must be at least 6 characters')
			return
		}

		setLoading(true)
		try {
			const { error } = await supabase.auth.updateUser({ password })
			if (error) throw error
			
			setPasswordSuccess('Password updated successfully. Please re-authenticate.')
			// Sign out and redirect
			setTimeout(async () => {
				await supabase.auth.signOut()
				router.push('/login')
			}, 2000)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			setPasswordError(message || 'Error updating password')
		} finally {
			setLoading(false)
		}
	}

	const handleRemoveMember = async (documentId: string, memberUserId: string) => {
		try {
			await removeDocumentMember(documentId, memberUserId)
			// Update local state
			setDocuments(prev => prev.map(doc => {
				if (doc.id === documentId) {
					return {
						...doc,
						document_members: doc.document_members.filter((m: { user_id: string }) => m.user_id !== memberUserId)
					}
				}
				return doc
			}))
		} catch (err) {
			console.error('Remove member error:', err)
			toast.error('Failed to remove member')
		}
	}

	return (
		<div className="h-screen bg-background text-on-background selection:bg-primary-container selection:text-on-primary-container flex flex-col font-body-md overflow-hidden">
			{/* Redesigned Top Header */}
			<header className="flex-none w-full z-50 bg-surface/5 backdrop-blur-md border-b border-black/10 dark:border-white/10 flex flex-col justify-center h-16">
				<div className="px-margin flex justify-between items-center">
					<div className="flex items-center gap-md">
						<img alt="Lekhan Logo" className="h-6 w-6 object-contain cursor-pointer hover:scale-110 premium-transition" src="/logo.png" onClick={() => router.push('/')} />
						<div className="flex items-center gap-sm group">
							<div className="px-2 py-1 text-sm font-bold text-on-surface truncate">
								Settings
							</div>
						</div>
					</div>
					<div className="flex items-center gap-md">
						<ThemeToggle />
						<ProfileMenu user={user} size="sm" />
					</div>
				</div>
			</header>

			<main className="flex-1 overflow-hidden flex justify-center">
				<div className="w-full max-w-6xl h-full flex flex-col lg:flex-row">
					<div className="flex-1 lg:w-2/3 h-full overflow-y-auto hide-scrollbar p-4 md:p-8 lg:pr-8">
						<div className="space-y-8 pb-16">
							{/* Profile Section */}
							<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm">
								<h2 className="text-2xl font-display-lg text-on-surface mb-6">Profile</h2>
								<div className="space-y-6">
									<div>
										<label className="block text-xs font-label-sm text-on-surface-variant uppercase tracking-wider mb-2">Email Address</label>
										<div className="text-on-surface font-medium bg-black/5 dark:bg-white/5 px-4 py-3 rounded-lg border border-black/5 dark:border-white/5">{user.email}</div>
									</div>
									<div>
										<label className="block text-xs font-label-sm text-on-surface-variant uppercase tracking-wider mb-2">Full Name</label>
										<div className="text-on-surface font-medium bg-black/5 dark:bg-white/5 px-4 py-3 rounded-lg border border-black/5 dark:border-white/5">{user.full_name || 'Not provided'}</div>
									</div>
								</div>
							</section>

							{/* Security Section */}
							<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">Security</h2>
								<p className="text-sm text-on-surface-variant mb-6">Update your password to keep your account secure.</p>
								<form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
									<div>
										<label className="block text-xs font-label-sm text-on-surface-variant uppercase tracking-wider mb-2">New Password</label>
										<input
											type="password"
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											className="w-full bg-black/5 dark:bg-surface-dim border border-black/10 dark:border-outline/30 rounded-lg px-4 py-3 text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/50 transition-all placeholder:text-on-surface-variant/50"
											placeholder="Minimum 6 characters"
											required
										/>
									</div>
									<div>
										<label className="block text-xs font-label-sm text-on-surface-variant uppercase tracking-wider mb-2">Confirm Password</label>
										<input
											type="password"
											value={confirmPassword}
											onChange={(e) => setConfirmPassword(e.target.value)}
											className="w-full bg-black/5 dark:bg-surface-dim border border-black/10 dark:border-outline/30 rounded-lg px-4 py-3 text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/50 transition-all placeholder:text-on-surface-variant/50"
											placeholder="Confirm new password"
											required
										/>
									</div>
									
									{passwordError && (
										<div className="p-3 bg-error-container/20 border border-error/50 rounded-lg text-error text-sm font-medium flex items-center gap-2 mt-4">
											<span className="material-symbols-outlined text-[18px]">error</span>
											{passwordError}
										</div>
									)}
									{passwordSuccess && (
										<div className="p-3 bg-[#a0f399]/20 border border-[#a0f399]/50 rounded-lg text-[#a0f399] text-sm font-medium flex items-center gap-2 mt-4">
											<span className="material-symbols-outlined text-[18px]">check_circle</span>
											{passwordSuccess}
										</div>
									)}

									<button
										type="submit"
										disabled={loading || password.length < 6 || password !== confirmPassword}
										className="mt-6 w-full bg-primary-container text-on-primary-fixed font-bold py-3 rounded-lg shadow-md hover:shadow-primary-container/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none"
									>
										{loading ? 'Updating...' : 'Change Password'}
									</button>
								</form>
							</section>

							{/* Collaborator Management Section */}
							<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">Manage Collaborators</h2>
								<p className="text-sm text-on-surface-variant mb-6">View and manage access to documents you own.</p>

								{documents.length === 0 ? (
									<div className="py-8 text-center bg-black/5 dark:bg-white/5 rounded-xl border border-black/5 dark:border-white/5 border-dashed">
										<p className="text-on-surface-variant italic">You don't own any documents yet.</p>
									</div>
								) : (
									<div className="space-y-6">
										{documents.map((doc) => {
											const members = doc.document_members || []
											
											return (
												<div key={doc.id} className="border border-black/10 dark:border-outline/10 rounded-xl p-5 bg-white/50 dark:bg-surface-dim/30 hover:bg-white dark:hover:bg-surface-dim/50 premium-transition">
													<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-2">
														<h3 className="font-title-lg font-semibold text-primary-container">{doc.title}</h3>
														<span className="text-xs font-bold px-3 py-1 bg-black/5 dark:bg-white/10 rounded-full text-on-surface-variant inline-block">
															{members.length} {members.length === 1 ? 'collaborator' : 'collaborators'}
														</span>
													</div>
													
													{members.length === 0 ? (
														<p className="text-sm text-on-surface-variant italic ml-1">No collaborators</p>
													) : (
														<ul className="space-y-2 mt-2">
															{members.map((member: { user_id: string; role: string; profiles?: { full_name?: string; email: string } }) => (
																<li key={member.user_id} className="flex justify-between items-center bg-black/5 dark:bg-surface-variant/10 p-3 rounded-lg border border-black/5 dark:border-white/5 group">
																	<div className="flex items-center gap-3">
																		<div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs uppercase">
																			{(member.profiles?.full_name || member.profiles?.email || '?').charAt(0)}
																		</div>
																		<div>
																			<div className="text-on-surface text-sm font-semibold">
																				{member.profiles?.full_name || member.profiles?.email}
																			</div>
																			<div className="text-xs text-on-surface-variant/80 mt-0.5">
																				{member.profiles?.email} • {member.role}
																			</div>
																		</div>
																	</div>
																	<button
																		onClick={() => handleRemoveMember(doc.id, member.user_id)}
																		className="text-error hover:text-error/80 text-xs font-bold px-3 py-1.5 border border-error/30 rounded-md hover:bg-error/10 transition-colors opacity-0 md:opacity-100 group-hover:opacity-100 focus:opacity-100"
																	>
																		Remove
																	</button>
																</li>
															))}
														</ul>
													)}
												</div>
											)
										})}
									</div>
								)}
							</section>
						</div>
					</div>

					{/* Right Sidebar Illustration */}
					<div className="hidden lg:flex lg:w-1/3 h-full items-center justify-center p-8">
						<div className="flex flex-col items-center justify-center">
							<div className="relative w-full max-w-sm">
								<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary-container/20 rounded-full blur-[80px] pointer-events-none -z-10"></div>
								<img src="/undraw_team-assignment_lzot.svg" alt="Settings illustration" className="w-full opacity-90 drop-shadow-sm hover:scale-105 premium-transition" />
							</div>
							<div className="mt-8 text-center px-4">
								<h3 className="font-headline-md text-lg font-bold text-on-surface mb-2">Workspace Control</h3>
								<p className="font-body-md text-sm text-on-surface-variant">Manage your profile, security, and document collaborations all in one place.</p>
							</div>
						</div>
					</div>
				</div>
			</main>
		</div>
	)
}
