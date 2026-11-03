'use client'

import { CreditCard, AlertTriangle, Gift, RefreshCw, ShieldCheck } from 'lucide-react'
import type { WorkspaceEntitlement } from '@/lib/billing/entitlements'
import type { ReferralSummary } from '@/services/billing/referral-credits'
import type { BillingCurrency } from '@/lib/billing/price-catalog'
import PricingMatrix, { type ActiveSubscription } from '@/components/pricing-plans'

export interface BillingSettingsProps {
	entitlement: WorkspaceEntitlement | null
	referral: ReferralSummary | null
	/** True while the owner's billing summary is being fetched. */
	loading?: boolean
	/** Human-readable summary read error; the plan card stays honest about it. */
	error?: string | null
	isFounding?: boolean
	defaultCurrency?: BillingCurrency
	busyAction?: 'portal' | 'cancel' | 'resubscribe' | 'refresh' | null
	onManageBilling: () => void
	onCancel: () => void
	onResubscribe: () => void
	onRefresh: () => void
}

const PLAN_NAMES: Record<string, string> = {
	free: 'Free',
	plus: 'Plus',
	pro: 'Pro',
	team: 'Team',
}

function planName(tier: string): string {
	return PLAN_NAMES[tier] ?? tier.charAt(0).toUpperCase() + tier.slice(1)
}

function formatDate(iso: string | null): string | null {
	if (!iso) return null
	const ms = Date.parse(iso)
	if (!Number.isFinite(ms)) return null
	return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function statusLabel(entitlement: WorkspaceEntitlement): string {
	if (entitlement.status === 'past_due') return entitlement.inGracePeriod ? 'Past due — in grace' : 'Past due — read-only'
	if (entitlement.status === 'canceled') return 'Canceled'
	if (entitlement.status === 'incomplete') return 'Payment incomplete'
	if (entitlement.tier === 'free') return 'Free'
	return 'Active'
}

/**
 * T12 — real billing states (US-5/US-6/US-7/US-2/US-4).
 *
 * Renders only server-resolved entitlement state. There is no credit counter and
 * no client-side price decision: plan/period/cancel/grace copy come from the
 * workspace row, and every money action posts an opaque request.
 */
export default function BillingSettings({
	entitlement,
	referral,
	loading = false,
	error = null,
	isFounding = false,
	defaultCurrency,
	busyAction = null,
	onManageBilling,
	onCancel,
	onResubscribe,
	onRefresh,
}: BillingSettingsProps) {
	const tier = entitlement?.tier ?? 'free'
	const hasSubscription = Boolean(entitlement && entitlement.gateway !== 'none')
	const periodEnd = formatDate(entitlement?.currentPeriodEnd ?? null)
	const graceEnd = formatDate(entitlement?.graceExpiresAt ?? null)
	const pastDueDate = formatDate(entitlement?.pastDueSince ?? null)
	const activeSubscription: ActiveSubscription | null =
		hasSubscription && entitlement
			? { gateway: entitlement.gateway as 'stripe' | 'razorpay', tier: entitlement.tier, cycle: entitlement.billingCycle === 'annual' ? 'annual' : 'monthly' }
			: null
	const founding = isFounding || entitlement?.isFounding === true

	return (
		<div className="space-y-8">
			<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm space-y-5">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<div className="flex items-center gap-2 flex-wrap">
							<h2 className="text-2xl font-display-lg text-on-surface">Subscription &amp; Plan</h2>
							<span className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold">
								{planName(tier)}
							</span>
							{founding && (
								<span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold">
									Founding price
								</span>
							)}
						</div>
						<p className="text-sm text-on-surface-variant mt-2">
							{loading
								? 'Loading your workspace billing state…'
								: entitlement
									? `Workspace billing is ${statusLabel(entitlement).toLowerCase()}.`
									: 'This workspace has no billing record yet — everything stays on Free.'}
						</p>
					</div>
					<button
						type="button"
						onClick={onRefresh}
						disabled={busyAction === 'refresh'}
						className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors disabled:opacity-60"
					>
						<RefreshCw className={`w-4 h-4 ${busyAction === 'refresh' ? 'animate-spin' : ''}`} />
						{busyAction === 'refresh' ? 'Refreshing…' : 'Refresh'}
					</button>
				</div>

				{error && (
					<div role="alert" className="p-4 rounded-xl bg-error/10 border border-error/30 text-error text-xs leading-relaxed">
						{error}
					</div>
				)}

				{entitlement?.inGracePeriod && (
					<div role="status" className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs leading-relaxed flex items-start gap-3">
						<AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
						<div>
							<span className="font-bold block mb-0.5">Payment failed{pastDueDate ? ` on ${pastDueDate}` : ''}</span>
							Everything stays available until {graceEnd ?? 'the grace window ends'}. Update your payment method to avoid interruption — your notes are never deleted.
						</div>
					</div>
				)}

				{entitlement?.relayReadOnly && (
					<div role="status" className="p-4 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs leading-relaxed flex items-start gap-3">
						<ShieldCheck className="w-5 h-5 shrink-0 mt-0.5 text-primary" />
						<div>
							<span className="font-bold block mb-0.5">Sync is read-only</span>
							Local editing still works and nothing has been deleted. Restore billing access to turn live sync back on.
						</div>
					</div>
				)}

				{entitlement?.cancelAtPeriodEnd && (
					<div role="status" className="p-4 rounded-xl bg-primary/5 border border-primary/20 text-xs leading-relaxed">
						<span className="font-bold block mb-0.5">
							{periodEnd ? `Cancels on ${periodEnd}` : 'Cancels at the end of the current period'}
						</span>
						You keep the paid plan until then. On the INR rail this reflects our accepted end-of-period instruction; your paid remainder is always honored.
					</div>
				)}

				<dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
					<div className="rounded-xl border border-black/5 dark:border-white/5 p-3">
						<dt className="text-on-surface-variant">Billing cycle</dt>
						<dd className="font-bold text-on-surface capitalize mt-1">
							{entitlement && entitlement.billingCycle !== 'none' ? entitlement.billingCycle : '—'}
						</dd>
					</div>
					<div className="rounded-xl border border-black/5 dark:border-white/5 p-3">
						<dt className="text-on-surface-variant">Renews / ends</dt>
						<dd className="font-bold text-on-surface mt-1">{periodEnd ?? '—'}</dd>
					</div>
					<div className="rounded-xl border border-black/5 dark:border-white/5 p-3">
						<dt className="text-on-surface-variant">Payment rail</dt>
						<dd className="font-bold text-on-surface capitalize mt-1">
							{entitlement && entitlement.gateway !== 'none' ? entitlement.gateway : 'None'}
						</dd>
					</div>
					<div className="rounded-xl border border-black/5 dark:border-white/5 p-3">
						<dt className="text-on-surface-variant">Seats</dt>
						<dd className="font-bold text-on-surface mt-1">{entitlement?.seats ?? '—'}</dd>
					</div>
				</dl>

				<div className="flex flex-wrap gap-3">
					{hasSubscription && (
						<button
							type="button"
							onClick={onManageBilling}
							disabled={busyAction === 'portal'}
							className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-primary text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-60"
						>
							<CreditCard className="w-4 h-4" />
							{busyAction === 'portal' ? 'Opening…' : 'Manage billing & payment method'}
						</button>
					)}
					{hasSubscription && !entitlement?.cancelAtPeriodEnd && entitlement?.status !== 'canceled' && (
						<button
							type="button"
							onClick={onCancel}
							disabled={busyAction === 'cancel'}
							className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-black/5 dark:bg-white/5 text-on-surface hover:bg-black/10 dark:hover:bg-white/10 transition-colors disabled:opacity-60"
						>
							{busyAction === 'cancel' ? 'Cancelling…' : 'Cancel at period end'}
						</button>
					)}
					{hasSubscription && (entitlement?.cancelAtPeriodEnd || entitlement?.status === 'canceled') && tier !== 'free' && (
						<button
							type="button"
							onClick={onResubscribe}
							disabled={busyAction === 'resubscribe'}
							className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-primary text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-60"
						>
							{busyAction === 'resubscribe' ? 'Restarting…' : 'Resubscribe'}
						</button>
					)}
				</div>

				<p className="text-[11px] text-on-surface-variant leading-relaxed">
					{entitlement?.gateway === 'razorpay' ? (
						<>
							On UPI / cards (Razorpay), <strong>plan changes and cycle switches are scheduled for the end of the current period</strong>; the provider applies them then and your paid remainder is honored. Cancelling never deletes pages.
						</>
					) : (
						<>
							Changing plans: <strong>upgrades apply immediately and are prorated</strong>; <strong>downgrades and cycle changes apply at the end of the current period</strong>. Cancelling never deletes pages — access simply returns to Free at period end.
						</>
					)}
				</p>
			</section>

			<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm space-y-3">
				<div className="flex items-center gap-2">
					<Gift className="w-5 h-5 text-primary" />
					<h3 className="text-lg font-display-md text-on-surface font-bold">Referral months</h3>
				</div>
				{referral ? (
					<>
						<p data-testid="referral-summary" className="text-xs text-on-surface-variant leading-relaxed">
							Invite a friend: <strong>{referral.bankedMonths}</strong> banked month{referral.bankedMonths === 1 ? '' : 's'} ready to apply, <strong>{referral.appliedMonths}</strong> already applied, cap {referral.bankCapMonths} months. Banked months extend your next renewal automatically — they are not cash and cannot be transferred.
						</p>
						<p className="text-[11px] text-on-surface-variant">
							{referral.activationGrants} activation grant{referral.activationGrants === 1 ? '' : 's'} · {referral.conversionGrants} conversion grant{referral.conversionGrants === 1 ? '' : 's'}
							{referral.capReached ? ' · bank cap reached' : ''}
						</p>
					</>
				) : (
					<p className="text-xs text-on-surface-variant">Referral activity will appear here once your first invite activates.</p>
				)}
			</section>

			<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm">
				<h3 className="text-lg font-display-md text-on-surface font-bold mb-2">Plans</h3>
				<p className="text-sm text-on-surface-variant mb-6">
					Pick the tier that fits. Free stays free — local pages, markdown and your own-key AI are never paywalled.
				</p>
				<PricingMatrix
					currentPlan={tier}
					isFounding={founding}
					defaultCurrency={defaultCurrency}
					activeSubscription={activeSubscription}
				/>
			</section>
		</div>
	)
}
