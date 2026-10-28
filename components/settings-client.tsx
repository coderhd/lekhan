'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { User, Users, CreditCard, Sparkles, Bot } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { removePageMember, updatePageMemberRole, fetchOwnedPagesWithMembers } from '@/services/graph'
import BYOKSettings from '@/components/byok-settings'
import BillingSettings from '@/components/billing/billing-settings'
import OwnershipTransferCard from '@/components/billing/ownership-transfer-card'
import type { WorkspaceEntitlement } from '@/lib/billing/entitlements'
import type { ReferralSummary } from '@/services/billing/referral-credits'
import { track } from '@/lib/analytics'
import { CustomSelect } from './ui/custom-select'
import { AIProviderSettings } from './settings/ai-provider-settings'
import { AIRegistryState } from '@/lib/ai/types'
import { getDefaultAIRegistryState } from '@/lib/ai/catalog'
import { encryptAIRegistry, syncVaultToSupabase, loadVaultFromSupabase } from '@/lib/ai/vault'
import { getOrCreateUserVaultKey } from '@/lib/crypto'

const EMPTY_PAGES: any[] = []

export default function SettingsClient({
	user,
	pages: initialPages = EMPTY_PAGES,
	setPages: setParentPages,
}: {
	user: { id?: string; email: string; full_name?: string }
	token?: string
	pages?: any[]
	setPages?: React.Dispatch<React.SetStateAction<any[]>>
}) {
	const router = useRouter()
	const [activeTab, setActiveTab] = useState<'profile' | 'collaborators' | 'usage' | 'billing' | 'ai'>('profile')
	const [registryState, setRegistryState] = useState<AIRegistryState>(getDefaultAIRegistryState())
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [passwordError, setPasswordError] = useState('')
	const [passwordSuccess, setPasswordSuccess] = useState('')
	const [loading, setLoading] = useState(false)
	const [currentPage, setCurrentPage] = useState(1)

	// Load encrypted AI vault on mount
	useEffect(() => {
		if (user?.id) {
			getOrCreateUserVaultKey(user.id).then(key => {
				loadVaultFromSupabase(supabase, user.id!, key).then(loadedState => {
					if (loadedState) {
						setRegistryState(loadedState)
					}
				}).catch(err => console.error('Failed to load vault:', err))
			}).catch(err => console.error('Failed to get vault key:', err))
		}
	}, [user?.id])

	const handleSaveRegistry = async (newState: AIRegistryState) => {
		setRegistryState(newState)
		if (user?.id) {
			try {
				const key = await getOrCreateUserVaultKey(user.id)
				const encrypted = await encryptAIRegistry(newState, key)
				await syncVaultToSupabase(supabase, user.id, encrypted)
			} catch (err: any) {
				console.error('Failed to sync AI vault:', err)
			}
		}
	}

	// Pages State for Collaborators tab
	const [pagesState, setPagesState] = useState<any[]>(initialPages)

	// T13 — ownership can only move to an existing collaborator (unique candidates).
	const ownershipCandidates = useMemo(() => {
		const byId = new Map<string, { id: string; email: string; name?: string }>()
		for (const doc of pagesState) {
			for (const member of (doc.page_members || []) as Array<{
				user_id?: string
				profiles?: { email?: string; full_name?: string }
			}>) {
				const id = member.user_id
				const email = member.profiles?.email
				if (!id || !email || id === user?.id) continue
				byId.set(id, { id, email, name: member.profiles?.full_name })
			}
		}
		return Array.from(byId.values())
	}, [pagesState, user?.id])

	useEffect(() => {
		setPagesState(initialPages)
	}, [initialPages])

	// Workspace billing entitlement (T12) — the source of the plan badge. There is
	// no AI credit state anywhere in settings; AI is never metered.
	const [entitlement, setEntitlement] = useState<WorkspaceEntitlement | null>(null)
	const [referral, setReferral] = useState<ReferralSummary | null>(null)
	const [billingLoading, setBillingLoading] = useState(true)
	const [billingError, setBillingError] = useState<string | null>(null)
	const [billingAction, setBillingAction] = useState<'portal' | 'cancel' | 'resubscribe' | 'refresh' | null>(null)
	const [defaultCurrency, setDefaultCurrency] = useState<'USD' | 'INR' | undefined>(undefined)
	const referralTracked = useRef<number | null>(null)

	// D3: the edge geo header seeds the explicit picker; the browser never guesses.
	useEffect(() => {
		let cancelled = false
		fetch('/api/billing/currency')
			.then((res) => (res.ok ? res.json() : null))
			.then((data) => {
				if (!cancelled && (data?.currency === 'INR' || data?.currency === 'USD')) {
					setDefaultCurrency(data.currency)
				}
			})
			.catch(() => {
				// Fall back to the client heuristic in the pricing matrix.
			})
		return () => {
			cancelled = true
		}
	}, [])

	const authHeaders = async (): Promise<Record<string, string>> => {
		const { data } = await supabase.auth.getSession()
		const token = data.session?.access_token
		return {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		}
	}

	// T13 — an emailed/pasted accept link must land on the card that consumes it.
	useEffect(() => {
		if (typeof window === 'undefined') return
		if (new URLSearchParams(window.location.search).get('transfer')) {
			setActiveTab('collaborators')
		}
	}, [])

	const loadBilling = async (action: 'refresh' | null = null) => {
		if (!user?.id) {
			setBillingLoading(false)
			return
		}
		if (action) setBillingAction(action)
		setBillingLoading(true)
		setBillingError(null)
		try {
			const res = await fetch('/api/billing/summary', { headers: await authHeaders() })
			const data = await res.json().catch(() => ({}))
			if (!res.ok) throw new Error(data.error || 'Could not read your billing state.')
			setEntitlement((data.entitlement as WorkspaceEntitlement | null) ?? null)
			setReferral((data.referral as ReferralSummary | null) ?? null)
			const appliedMonths = Number(data.referral?.appliedMonths ?? 0)
			if (appliedMonths > 0 && referralTracked.current !== appliedMonths) {
				referralTracked.current = appliedMonths
				track('billing_referral_credit_applied', { months: appliedMonths })
			}
		} catch (err) {
			setBillingError(err instanceof Error ? err.message : 'Could not read your billing state.')
		} finally {
			setBillingLoading(false)
			setBillingAction(null)
		}
	}

	useEffect(() => {
		void loadBilling()
	}, [user?.id])

	const handleManageBilling = async () => {
		setBillingAction('portal')
		try {
			const res = await fetch('/api/billing/portal', { method: 'POST', headers: await authHeaders() })
			const data = await res.json().catch(() => ({}))
			if (!res.ok || !data.url) throw new Error(data.error || 'Could not open the billing portal.')
			window.location.assign(data.url)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not open the billing portal.')
		} finally {
			setBillingAction(null)
		}
	}

	const handleCancel = async () => {
		setBillingAction('cancel')
		try {
			const res = await fetch('/api/billing/cancel', { method: 'POST', headers: await authHeaders() })
			const data = await res.json().catch(() => ({}))
			if (!res.ok) throw new Error(data.error || 'Could not cancel the subscription.')
			toast.success('Cancellation scheduled for the end of your current period.')
			await loadBilling()
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not cancel the subscription.')
		} finally {
			setBillingAction(null)
		}
	}

	const handleResubscribe = async () => {
		if (!entitlement || entitlement.tier === 'free') return
		setBillingAction('resubscribe')
		try {
			const cycle = entitlement.billingCycle === 'annual' ? 'annual' : 'monthly'
			const currency = entitlement.gateway === 'razorpay' ? 'INR' : 'USD'
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({
					tier: entitlement.tier,
					cycle,
					currency,
					...(entitlement.tier === 'team' ? { seats: entitlement.seats ?? 2 } : {}),
				}),
			})
			const data = await res.json().catch(() => ({}))
			if (!res.ok || !data.checkoutUrl) throw new Error(data.error || 'Could not restart your subscription.')
			window.location.assign(data.checkoutUrl)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not restart your subscription.')
		} finally {
			setBillingAction(null)
		}
	}

	useEffect(() => {
		if (typeof window !== 'undefined') {
			const savedTheme = (localStorage.getItem('theme') as 'light' | 'dark') || 'dark'
			if (savedTheme === 'dark') {
				document.documentElement.classList.add('dark')
			} else {
				document.documentElement.classList.remove('dark')
			}
		}
	}, [])

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

	const handleRemoveMember = async (pageId: string, memberUserId: string) => {
		try {
			await removePageMember(pageId, memberUserId)
			if (user?.id) {
				const updatedPages = await fetchOwnedPagesWithMembers(user.id)
				if (setParentPages) {
					setParentPages(updatedPages)
				}
				setPagesState(updatedPages)
			}
			toast.success('Collaborator removed successfully')
		} catch {
			toast.error('Failed to remove collaborator')
		}
	}

	const handleRoleChange = async (pageId: string, memberUserId: string, role: 'editor' | 'viewer') => {
		try {
			await updatePageMemberRole(pageId, memberUserId, role)
			setPagesState(prev => prev.map((page: any) =>
				page.id === pageId
					? { ...page, page_members: (page.page_members || []).map((m: any) => m.user_id === memberUserId ? { ...m, role } : m) }
					: page
			))
			toast.success('Role updated successfully')
		} catch {
			toast.error('Failed to update role')
		}
	}

	// Pagination for Collaborations
	const itemsPerPage = 5
	const totalPages = Math.ceil(pagesState.length / itemsPerPage) || 1
	const paginatedPages = pagesState.slice(
		(currentPage - 1) * itemsPerPage,
		currentPage * itemsPerPage
	)

	const handleTabKeyDown = (e: React.KeyboardEvent) => {
		const tabs: Array<'ai' | 'profile' | 'collaborators' | 'usage' | 'billing'> = ['ai', 'profile', 'collaborators', 'usage', 'billing']
		const currentIndex = tabs.indexOf(activeTab)
		if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
			e.preventDefault()
			const nextIndex = (currentIndex + 1) % tabs.length
			setActiveTab(tabs[nextIndex])
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
			e.preventDefault()
			const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
			setActiveTab(tabs[prevIndex])
		}
	}

	return (
		<div className="h-screen bg-background text-on-background selection:bg-primary-container selection:text-on-primary-container flex flex-col font-body-md overflow-hidden">
			<main className="flex-1 overflow-hidden flex justify-center px-6 md:px-10">
				<div className="w-full max-w-[1400px] h-full flex flex-col lg:flex-row gap-8 py-8">
					{/* Sidebar Navigation */}
					<aside 
						role="tablist" 
						aria-label="Settings navigation" 
						onKeyDown={handleTabKeyDown}
						className="w-full lg:w-64 shrink-0 flex flex-row lg:flex-col gap-2 overflow-x-auto border-b lg:border-b-0 lg:border-r border-black/10 dark:border-white/10 pb-4 lg:pb-0 lg:pr-6"
					>
						<button
							id="settings-tab-ai"
							type="button"
							role="tab"
							aria-selected={activeTab === 'ai'}
							aria-controls="settings-panel-ai"
							onClick={() => setActiveTab('ai')}
							className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${activeTab === 'ai'
								? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
								: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5'
								}`}
						>
							<Bot className="w-4 h-4" /> AI & Models
						</button>
						<button
							id="settings-tab-profile"
							type="button"
							role="tab"
							aria-selected={activeTab === 'profile'}
							aria-controls="settings-panel-profile"
							onClick={() => setActiveTab('profile')}
							className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${activeTab === 'profile'
								? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
								: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5'
								}`}
						>
							<User className="w-4 h-4" /> Profile & Security
						</button>
						<button
							id="settings-tab-collaborators"
							type="button"
							role="tab"
							aria-selected={activeTab === 'collaborators'}
							aria-controls="settings-panel-collaborators"
							onClick={() => setActiveTab('collaborators')}
							className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${activeTab === 'collaborators'
								? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
								: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5'
								}`}
						>
							<Users className="w-4 h-4" /> Collaborators & Access
						</button>
						<button
							id="settings-tab-usage"
							type="button"
							role="tab"
							aria-selected={activeTab === 'usage'}
							aria-controls="settings-panel-usage"
							onClick={() => setActiveTab('usage')}
							className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${activeTab === 'usage'
								? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
								: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5'
								}`}
						>
							<Sparkles className="w-4 h-4" /> AI Usage
						</button>
						<button
							id="settings-tab-billing"
							type="button"
							role="tab"
							aria-selected={activeTab === 'billing'}
							aria-controls="settings-panel-billing"
							onClick={() => setActiveTab('billing')}
							className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${activeTab === 'billing'
								? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
								: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5'
								}`}
						>
							<CreditCard className="w-4 h-4" /> Billing & Subscription
						</button>
					</aside>

					{/* Main Tab Content */}
					<div className="flex-1 h-full overflow-y-auto hide-scrollbar pb-16">
						{activeTab === 'ai' && (
							<div id="settings-panel-ai" role="tabpanel" aria-labelledby="settings-tab-ai" className="space-y-8 w-full max-w-4xl">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">AI & Models</h2>
								<p className="text-sm text-on-surface-variant mb-6">Manage your connected AI providers, local models, and billing tiers.</p>
								<AIProviderSettings 
									user={user} 
									registryState={registryState} 
									onSaveRegistry={handleSaveRegistry} 
								/>
							</div>
						)}

						{activeTab === 'profile' && (
							<div id="settings-panel-profile" role="tabpanel" aria-labelledby="settings-tab-profile" className="space-y-8 max-w-3xl">
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
							</div>
						)}

						{activeTab === 'collaborators' && (
							<div id="settings-panel-collaborators" role="tabpanel" aria-labelledby="settings-tab-collaborators" className="space-y-8 max-w-3xl">
								<OwnershipTransferCard candidates={ownershipCandidates} />
								<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm">
									<h2 className="text-2xl font-display-lg text-on-surface mb-2">Manage Collaborators</h2>
									<p className="text-sm text-on-surface-variant mb-6">View and manage access to pages you own.</p>

									{pagesState.length === 0 ? (
										<div className="py-8 text-center bg-black/5 dark:bg-white/5 rounded-xl border border-black/5 dark:border-white/5 border-dashed">
											<p className="text-on-surface-variant italic text-sm">You don't own any pages yet.</p>
										</div>
									) : (
										<div className="space-y-6">
											{paginatedPages.map((doc: any) => {
												const members = doc.page_members || []

												return (
													<div
														key={doc.id}
														className="border border-black/10 dark:border-outline/10 rounded-xl p-5 bg-white/50 dark:bg-surface-dim/30 hover:bg-white dark:hover:bg-surface-dim/50 transition-all shadow-sm"
													>
														<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-2">
															<h3 className="font-title-lg font-semibold text-primary-container">{doc.title || 'Untitled Page'}</h3>
															<span className="text-xs font-bold px-3 py-1 bg-black/5 dark:bg-white/10 rounded-full text-on-surface-variant inline-block w-fit">
																{members.length} {members.length === 1 ? 'collaborator' : 'collaborators'}
															</span>
														</div>

														{members.length === 0 ? (
															<p className="text-xs text-on-surface-variant italic ml-1">No collaborators added yet.</p>
														) : (
															<ul className="space-y-2 mt-2">
																{members.map((member: { user_id: string; role: string; profiles?: { full_name?: string; email: string } }) => (
<li
													key={member.user_id}
													className="flex justify-between items-center bg-black/5 dark:bg-surface-variant/10 p-3 rounded-lg border border-black/5 dark:border-white/5 group"
												>
													<div className="flex items-center gap-3">
														<div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs uppercase shrink-0">
															{(member.profiles?.full_name || member.profiles?.email || '?').charAt(0)}
														</div>
														<div className="min-w-0">
															<div className="text-on-surface text-xs font-semibold truncate">
																{member.profiles?.full_name || member.profiles?.email}
															</div>
															<div className="text-[11px] text-on-surface-variant/80 mt-0.5 truncate">
																{member.profiles?.email} • <span className="capitalize font-medium text-primary">{member.role}</span>
															</div>
														</div>
													</div>
													{member.role !== 'owner' && (
														<div className="flex items-center gap-2 shrink-0">
															<CustomSelect
																value={member.role as 'editor' | 'viewer'}
																onValueChange={(val) => handleRoleChange(doc.id, member.user_id, val as 'editor' | 'viewer')}
																options={[
																	{ label: 'Editor', value: 'editor' },
																	{ label: 'Viewer', value: 'viewer' },
																]}
																triggerClassName="h-7 w-[100px] bg-transparent border border-black/10 dark:border-white/10 rounded-lg text-[10px] font-medium text-on-surface px-2 focus:ring-0"
																contentClassName="w-[100px]"
															/>
															<button
																onClick={() => handleRemoveMember(doc.id, member.user_id)}
																className="text-error hover:text-error/80 text-xs font-bold px-3 py-1.5 border border-error/30 rounded-md hover:bg-error/10 transition-colors shrink-0"
															>
																Remove
															</button>
														</div>
													)}
												</li>
																))}
															</ul>
														)}
													</div>
												)
											})}

											{totalPages > 1 && (
												<div className="flex items-center justify-between pt-4 border-t border-black/10 dark:border-white/10">
													<button
														onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
														disabled={currentPage === 1}
														className="px-4 py-2 text-xs font-semibold rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50 disabled:pointer-events-none transition-colors"
													>
														Previous
													</button>
													<span className="text-xs text-on-surface-variant">
														Page {currentPage} of {totalPages}
													</span>
													<button
														onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
														disabled={currentPage === totalPages}
														className="px-4 py-2 text-xs font-semibold rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50 disabled:pointer-events-none transition-colors"
													>
														Next
													</button>
												</div>
											)}
										</div>
									)}
								</section>
							</div>
						)}

						{/* AI access & usage — no credit meter exists any more (T12). */}
						{activeTab === 'usage' && (
							<div id="settings-panel-usage" role="tabpanel" aria-labelledby="settings-tab-usage" className="space-y-8 max-w-3xl">
								<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm space-y-4">
									<div className="flex justify-between items-start gap-3">
										<div>
											<h2 className="text-2xl font-display-lg text-on-surface mb-1">AI access</h2>
											<p className="text-xs text-on-surface-variant leading-relaxed">
												Lekhan never meters AI. Bring your own key (BYOK), run local models (BYOL), or use the free-key on-ramp — free models may change or be slower.
											</p>
										</div>
										<span className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold capitalize shrink-0">
											{entitlement?.tier ?? 'free'} plan
										</span>
									</div>
									<ul className="text-xs text-on-surface-variant space-y-2">
										<li className="flex items-start gap-2"><Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />Your provider key is used directly; provider usage is billed by that provider, not by Lekhan.</li>
										<li className="flex items-start gap-2"><Bot className="w-4 h-4 text-primary shrink-0 mt-0.5" />No plan bundles an AI allowance, and no AI action is blocked by a Lekhan quota.</li>
									</ul>
								</section>

								{/* BYOK Settings Card inside Usage Tab */}
								<BYOKSettings />
							</div>
						)}

						{/* Real billing states + plan matrix (T12). */}
						{activeTab === 'billing' && (
							<div id="settings-panel-billing" role="tabpanel" aria-labelledby="settings-tab-billing" className="space-y-8 max-w-5xl">
								<BillingSettings
									entitlement={entitlement}
									referral={referral}
									loading={billingLoading}
									error={billingError}
									isFounding={entitlement?.isFounding ?? false}
									defaultCurrency={defaultCurrency}
									busyAction={billingAction}
									onManageBilling={() => void handleManageBilling()}
									onCancel={() => void handleCancel()}
									onResubscribe={() => void handleResubscribe()}
									onRefresh={() => void loadBilling('refresh')}
								/>
							</div>
						)}
					</div>
				</div>
			</main>
		</div>
	)
}
