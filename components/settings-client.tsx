'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { User, Users, CreditCard, ChevronLeft, ChevronRight, Sparkles, AlertTriangle, Zap } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { GlobalHeaderSlot } from '@/components/layout/global-header-context'
import BYOKSettings from '@/components/byok-settings'
import PricingMatrix from '@/components/pricing-plans'

export default function SettingsClient({
	user,
	token,
	documents: initialDocuments = [],
	setDocuments: setParentDocuments,
}: {
	user: { email: string; full_name?: string }
	token?: string
	documents?: any[]
	setDocuments?: React.Dispatch<React.SetStateAction<any[]>>
}) {
	const router = useRouter()
	const [activeTab, setActiveTab] = useState<'profile' | 'collaborators' | 'usage' | 'billing'>('profile')
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [passwordError, setPasswordError] = useState('')
	const [passwordSuccess, setPasswordSuccess] = useState('')
	const [loading, setLoading] = useState(false)
	const [currentPage, setCurrentPage] = useState(1)

	// User AI Credits (DB state simulation/sync)
	const userPlan = 'free'
	const totalAllocated = 50
	const usedCredits = 15
	const remainingCredits = Math.max(0, totalAllocated - usedCredits)
	const percentageRemaining = (remainingCredits / totalAllocated) * 100
	const isLowCredits = percentageRemaining <= 10 && remainingCredits > 0
	const isDepleted = remainingCredits === 0

	useEffect(() => {
		if (typeof window !== 'undefined') {
			const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' || 'dark'
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

	// Pagination for Collaborations
	const itemsPerPage = 5
	const totalPages = Math.ceil(initialDocuments.length / itemsPerPage) || 1
	const paginatedDocuments = initialDocuments.slice(
		(currentPage - 1) * itemsPerPage,
		currentPage * itemsPerPage
	)

	return (
		<div className="h-screen bg-background text-on-background selection:bg-primary-container selection:text-on-primary-container flex flex-col font-body-md overflow-hidden">
			{/* Project Back to Editor Action into Header */}
			<GlobalHeaderSlot slot="right">
				<div className="flex items-center gap-3">
					<button
						onClick={() => router.push('/')}
						className="text-xs bg-black/10 dark:bg-white/10 text-on-surface font-bold px-4 py-2 rounded-lg hover:bg-black/20 dark:hover:bg-white/20 transition-colors active:scale-95 shadow-sm flex items-center gap-2"
					>
						Back to Editor
					</button>
				</div>
			</GlobalHeaderSlot>

			<main className="flex-1 overflow-hidden flex justify-center px-6 md:px-10">
				<div className="w-full max-w-[1400px] h-full flex flex-col lg:flex-row gap-8 py-8">
					{/* Sidebar Navigation */}
					<aside className="w-full lg:w-64 shrink-0 flex flex-row lg:flex-col gap-2 overflow-x-auto border-b lg:border-b-0 lg:border-r border-black/10 dark:border-white/10 pb-4 lg:pb-0 lg:pr-6">
						<button
							type="button"
							onClick={() => setActiveTab('profile')}
							className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
								activeTab === 'profile'
									? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
									: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5'
							}`}
						>
							<User className="w-4 h-4" /> Profile & Security
						</button>
						<button
							type="button"
							onClick={() => setActiveTab('collaborators')}
							className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
								activeTab === 'collaborators'
									? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
									: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5'
							}`}
						>
							<Users className="w-4 h-4" /> Collaborators & Access
						</button>
						<button
							type="button"
							onClick={() => setActiveTab('usage')}
							className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
								activeTab === 'usage'
									? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
									: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5'
							}`}
						>
							<Sparkles className="w-4 h-4" /> Usage & Credits
						</button>
						<button
							type="button"
							onClick={() => setActiveTab('billing')}
							className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
								activeTab === 'billing'
									? 'bg-primary-container text-on-primary-container font-bold shadow-sm'
									: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5'
							}`}
						>
							<CreditCard className="w-4 h-4" /> Billing & Subscription
						</button>
					</aside>

					{/* Main Tab Content */}
					<div className="flex-1 h-full overflow-y-auto hide-scrollbar pb-16">
						{activeTab === 'profile' && (
							<div className="space-y-8 max-w-3xl">
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
							<div className="space-y-8 max-w-3xl">
								<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm">
									<h2 className="text-2xl font-display-lg text-on-surface mb-2">Shared Documents</h2>
									<p className="text-sm text-on-surface-variant mb-6">Manage document access and active collaborations.</p>

									{initialDocuments.length === 0 ? (
										<div className="text-center py-12 bg-black/5 dark:bg-white/5 rounded-xl border border-dashed border-black/10 dark:border-white/10">
											<Users className="w-8 h-8 mx-auto text-on-surface-variant/40 mb-3" />
											<p className="text-sm font-medium text-on-surface">No shared documents found</p>
											<p className="text-xs text-on-surface-variant mt-1">Documents shared with you or by you will appear here.</p>
										</div>
									) : (
										<>
											<div className="divide-y divide-black/5 dark:divide-white/5">
												{paginatedDocuments.map((doc: any) => (
													<div key={doc.id} className="py-4 flex items-center justify-between gap-4">
														<div>
															<h4 className="text-sm font-bold text-on-surface">{doc.title || 'Untitled Document'}</h4>
															<p className="text-xs text-on-surface-variant/70 mt-0.5">Role: <span className="capitalize font-medium text-primary">{doc.role || 'Editor'}</span></p>
														</div>
														<button
															onClick={() => router.push(`/doc/${doc.id}`)}
															className="text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-on-surface px-3 py-1.5 rounded-lg transition"
														>
															Open Document
														</button>
													</div>
												))}
											</div>

											{/* Pagination Controls */}
											{totalPages > 1 && (
												<div className="flex items-center justify-between pt-6 border-t border-black/5 dark:border-white/5 mt-4">
													<p className="text-xs text-on-surface-variant">Page {currentPage} of {totalPages}</p>
													<div className="flex items-center gap-2">
														<button
															onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
															disabled={currentPage === 1}
															className="p-2 rounded-lg border border-black/10 dark:border-white/10 disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/5"
														>
															<ChevronLeft className="w-4 h-4" />
														</button>
														<button
															onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
															disabled={currentPage === totalPages}
															className="p-2 rounded-lg border border-black/10 dark:border-white/10 disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/5"
														>
															<ChevronRight className="w-4 h-4" />
														</button>
													</div>
												</div>
											)}
										</>
									)}
								</section>
							</div>
						)}

						{/* Dedicated Usage & Credits Tab */}
						{activeTab === 'usage' && (
							<div className="space-y-8 max-w-3xl">
								{/* Credit Progress Card */}
								<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm space-y-6">
									<div className="flex justify-between items-start">
										<div>
											<h2 className="text-2xl font-display-lg text-on-surface mb-1">AI Credit Consumption</h2>
											<p className="text-xs text-on-surface-variant">Monthly AI credit quota included with your {userPlan.toUpperCase()} plan.</p>
										</div>
										<span className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold capitalize">
											{userPlan} Plan
										</span>
									</div>

									{/* Low Credit Warning Banner (Remaining ≤ 10%) */}
									{isLowCredits && (
										<div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs leading-relaxed flex items-start gap-3">
											<AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
											<div>
												<span className="font-bold block mb-0.5">⚠️ Low AI Credits Warning ({remainingCredits} credits left)</span>
												You have used 90%+ of your monthly credits. Connect your own Sarvam API key below or upgrade your plan to continue using AI tools uninterrupted.
											</div>
										</div>
									)}

									{/* Depleted Credit Notice (0 credits left) */}
									{isDepleted && (
										<div className="p-4 rounded-xl bg-error/10 border border-error/30 text-error text-xs leading-relaxed flex items-start gap-3">
											<AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
											<div>
												<span className="font-bold block mb-0.5">🛑 Monthly AI Credits Depleted</span>
												You have used 100% of your plan credits. Please connect your BYOK Sarvam API Key below or upgrade your plan to continue using Lekhan Bot.
											</div>
										</div>
									)}

									{/* Meter / Progress Bar */}
									<div className="space-y-2">
										<div className="flex justify-between text-xs font-medium">
											<span className="text-on-surface-variant">{usedCredits} / {totalAllocated} Credits Used</span>
											<span className="text-primary font-bold">{remainingCredits} Credits Remaining</span>
										</div>
										<div className="w-full h-3 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
											<div
												className={`h-full transition-all duration-500 rounded-full ${
													isDepleted ? 'bg-error' : isLowCredits ? 'bg-amber-500' : 'bg-primary'
												}`}
												style={{ width: `${Math.min(100, (usedCredits / totalAllocated) * 100)}%` }}
											/>
										</div>
									</div>
								</section>

								{/* Sarvam AI Credit Cost Reference Table */}
								<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm space-y-4">
									<div className="flex items-center gap-2">
										<Zap className="w-5 h-5 text-primary" />
										<h3 className="text-lg font-display-md text-on-surface font-bold">Sarvam AI Credit Consumption Rates</h3>
									</div>
									<p className="text-xs text-on-surface-variant">
										Credit consumption rates for Lekhan Bot operations. Additional usage when using your own API key is charged directly based on official Sarvam API rates. Lekhan plays no role in BYOK billing or pricing.
									</p>

									<div className="overflow-x-auto">
										<table className="w-full text-left text-xs text-on-surface border-collapse">
											<thead>
												<tr className="border-b border-black/10 dark:border-white/10 text-on-surface-variant uppercase text-[10px] tracking-wider">
													<th className="py-2.5 px-3">API Service</th>
													<th className="py-2.5 px-3">Description</th>
													<th className="py-2.5 px-3 text-right">Credit Cost</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-black/5 dark:divide-white/5">
												<tr>
													<td className="py-3 px-3 font-bold">Sarvam Chat (105B / 30B)</td>
													<td className="py-3 px-3 text-on-surface-variant">Contextual edit, summary, rewrite</td>
													<td className="py-3 px-3 text-right font-bold text-primary">1 Credit / req</td>
												</tr>
												<tr>
													<td className="py-3 px-3 font-bold">Text to Speech (Bulbul v2/v3)</td>
													<td className="py-3 px-3 text-on-surface-variant">Read Aloud voice generation</td>
													<td className="py-3 px-3 text-right font-bold text-primary">1 Credit / 1K chars</td>
												</tr>
												<tr>
													<td className="py-3 px-3 font-bold">Translate & Transliterate</td>
													<td className="py-3 px-3 text-on-surface-variant">Indic language conversion</td>
													<td className="py-3 px-3 text-right font-bold text-primary">1 Credit / 10K chars</td>
												</tr>
												<tr>
													<td className="py-3 px-3 font-bold">Speech to Text (ASR)</td>
													<td className="py-3 px-3 text-on-surface-variant">Audio transcription</td>
													<td className="py-3 px-3 text-right font-bold text-primary">5 Credits / min</td>
												</tr>
												<tr>
													<td className="py-3 px-3 font-bold">Sarvam Vision</td>
													<td className="py-3 px-3 text-on-surface-variant">OCR & Document digitization</td>
													<td className="py-3 px-3 text-right font-bold text-primary">2 Credits / page</td>
												</tr>
											</tbody>
										</table>
									</div>
								</section>

								{/* BYOK Settings Card inside Usage Tab */}
								<BYOKSettings />
							</div>
						)}

						{/* Full Pricing & Subscription Matrix inside Billing Tab */}
						{activeTab === 'billing' && (
							<div className="space-y-8 max-w-5xl">
								<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm">
									<h2 className="text-2xl font-display-lg text-on-surface mb-2">Subscription & Plan</h2>
									<p className="text-sm text-on-surface-variant mb-6">Manage your plan billing and compare plan tiers.</p>
									<PricingMatrix currentPlan={userPlan} />
								</section>
							</div>
						)}
					</div>
				</div>
			</main>
		</div>
	)
}
