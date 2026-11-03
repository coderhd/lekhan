'use client'

import { useMemo, useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import {
	TEAM_MAX_SEATS,
	TEAM_MIN_SEATS,
	formatPrice,
	priceAmountMajor,
	type BillingCurrency,
	type BillingCycle,
	type PriceCohort,
} from '@/lib/billing/price-catalog'

export interface ActiveSubscription {
	gateway: 'stripe' | 'razorpay'
	tier: string
	/** Current cycle, so a monthly↔annual switch is treated as a same-subscription change. */
	cycle?: 'monthly' | 'annual'
}

interface PlanDefinition {
	id: 'free' | 'plus' | 'pro' | 'team' | 'enterprise'
	name: string
	tagline: string
	features: string[]
	popular?: boolean
	perSeat?: boolean
	userBadge?: string
	cumulativeHeader?: string
	buttonText: string
}

/**
 * T12 — PRD §5.1 pricing matrix.
 *
 * Credits are gone from every card: AI is never metered by Lekhan (free-key
 * on-ramp, BYOK or BYOL only). The `go` tier is retired and renamed Plus to
 * match marketing. Amounts come from the shared display catalogue; the client
 * still never decides a price — CTAs POST an opaque {tier, cycle, currency,
 * seats} request and the server resolves the gateway price object from env.
 */
const INDIVIDUAL_PLANS: PlanDefinition[] = [
	{
		id: 'free',
		name: 'Free',
		tagline: 'Local-first notes for individuals — forever free.',
		cumulativeHeader: 'Everything you need to think',
		buttonText: 'Get started',
		features: [
			'Unlimited pages, no document cap',
			'2 collaborators per page',
			'Markdown & Obsidian import / export',
			'AI on your own key (BYOK / BYOL) or the free-key on-ramp',
			'Local-first offline sync',
		],
	},
	{
		id: 'plus',
		name: 'Plus',
		tagline: 'For active creators who want more room and history.',
		cumulativeHeader: 'Everything in Free, plus:',
		buttonText: 'Get Plus plan',
		features: [
			'10 collaborators per page',
			'14-day version history',
			'Full mentions support (owners & editors)',
			'AI via free-key on-ramp, BYOK or BYOL',
			'Email support',
		],
	},
	{
		id: 'pro',
		name: 'Pro',
		tagline: 'Higher limits and priority access for power users.',
		popular: true,
		cumulativeHeader: 'Everything in Plus, plus:',
		buttonText: 'Get Pro plan',
		features: [
			'25 collaborators per page',
			'90-day version history',
			'Priority sync & processing',
			'Priority email support',
		],
	},
]

const TEAM_PLANS: PlanDefinition[] = [
	{
		id: 'team',
		name: 'Team',
		tagline: 'Predictable per-seat billing for growing teams.',
		perSeat: true,
		userBadge: '2–25 seats',
		cumulativeHeader: 'Everything in Pro, plus:',
		buttonText: 'Get Team plan',
		features: [
			'Collaborator cap scales with your seats',
			'1-year version history',
			'Centralized team billing & admin controls',
			'Shared team templates & workspaces',
			'Billed in USD only at launch',
		],
	},
	{
		id: 'enterprise',
		name: 'Enterprise',
		tagline: 'Flexible pooled usage & dedicated infrastructure.',
		userBadge: '25+ seats',
		cumulativeHeader: 'All Team features, plus:',
		buttonText: 'Contact Sales',
		features: [
			'Dedicated AI & sync infrastructure',
			'Custom SLA & enterprise security',
			'SSO / SAML authentication',
			'Dedicated account manager',
			'Unlimited version history',
		],
	},
]

function detectCurrency(): BillingCurrency {
	if (typeof navigator === 'undefined') return 'USD'
	try {
		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
		if (timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta') return 'INR'
	} catch {
		// Fall through to language detection.
	}
	return navigator.language?.toLowerCase().endsWith('-in') ? 'INR' : 'USD'
}

async function authHeaders(): Promise<Record<string, string>> {
	const { data } = await supabase.auth.getSession()
	const token = data.session?.access_token
	return {
		'Content-Type': 'application/json',
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	}
}

export default function PricingMatrix({
	currentPlan = 'free',
	isLandingPage = false,
	isFounding = false,
	defaultCurrency,
	activeSubscription = null,
}: {
	currentPlan?: string
	isLandingPage?: boolean
	isFounding?: boolean
	/** Country-derived default (x-vercel-ip-country on the server); never a forced currency. */
	defaultCurrency?: BillingCurrency
	activeSubscription?: ActiveSubscription | null
}) {
	const router = useRouter()
	const [category, setCategory] = useState<'individual' | 'team'>('individual')
	const [isYearly, setIsYearly] = useState(true)
	const [currency, setCurrency] = useState<BillingCurrency>(defaultCurrency ?? detectCurrency())
	const [seats, setSeats] = useState(TEAM_MIN_SEATS)
	const [pending, setPending] = useState<string | null>(null)

	// Adopt the server-derived default when it arrives (explicit picker still wins).
	useEffect(() => {
		if (defaultCurrency) setCurrency(defaultCurrency)
	}, [defaultCurrency])

	const cohort: PriceCohort = isFounding ? 'founding' : 'ga'
	const cycle: BillingCycle = isYearly ? 'annual' : 'monthly'
	const plansToDisplay = category === 'individual' ? INDIVIDUAL_PLANS : TEAM_PLANS

	const teamMonthlyTotal = useMemo(() => {
		const perSeat = priceAmountMajor('team', cycle, 'USD', cohort)
		return cycle === 'annual' ? perSeat / 12 : perSeat
	}, [cycle, cohort])

	const beginCheckout = async (plan: PlanDefinition) => {
		setPending(plan.id)
		try {
			const isPlanChange = Boolean(activeSubscription) &&
				(activeSubscription?.tier !== plan.id ||
					(Boolean(activeSubscription?.cycle) && activeSubscription?.cycle !== cycle))
			track('upgrade_clicked', {
				plan: plan.id,
				billing_cycle: isYearly ? 'yearly' : 'monthly',
			})

			// US-5 / PDEC-12 — a change to an existing subscription rides provider-native
			// machinery: Stripe = Billing Portal (immediate prorated upgrades, period-end
			// downgrades); Razorpay = scheduled plan change at cycle end.
			if (isPlanChange && activeSubscription?.gateway === 'stripe') {
				const res = await fetch('/api/billing/portal', {
					method: 'POST',
					headers: await authHeaders(),
				})
				const data = await res.json().catch(() => ({}))
				if (!res.ok || !data.url) throw new Error(data.error || 'Could not open the billing portal.')
				window.location.assign(data.url)
				return
			}
			if (isPlanChange && activeSubscription?.gateway === 'razorpay') {
				const res = await fetch('/api/billing/plan-change', {
					method: 'POST',
					headers: await authHeaders(),
					body: JSON.stringify({ tier: plan.id, cycle }),
				})
				const data = await res.json().catch(() => ({}))
				if (!res.ok) throw new Error(data.error || 'Could not schedule the plan change.')
				toast.success(
					data.effectiveAt
						? `Plan change scheduled for ${new Date(data.effectiveAt).toLocaleDateString()}.`
						: 'Plan change scheduled for the end of your current period.',
				)
				return
			}

			track('billing_checkout_started', {
				tier: plan.id,
				cycle,
				currency: plan.id === 'team' ? 'USD' : currency,
			})
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({
					tier: plan.id,
					cycle,
					currency: plan.id === 'team' ? 'USD' : currency,
					...(plan.id === 'team' ? { seats } : {}),
				}),
			})
			const data = await res.json().catch(() => ({}))
			if (!res.ok || !data.checkoutUrl) {
				throw new Error(data.error || 'Could not start checkout. Please try again.')
			}
			window.location.assign(data.checkoutUrl)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
		} finally {
			setPending(null)
		}
	}

	const handlePlanAction = (plan: PlanDefinition) => {
		if (plan.id === 'enterprise') {
			track('upgrade_clicked', { plan: plan.id })
			router.push('/contact')
			return
		}
		if (plan.id === 'free') {
			// US-4 AC3 — a free CTA never opens a payment wall.
			router.push('/signup')
			return
		}
		if (!isLandingPage && plan.id === currentPlan) return
		if (plan.id === 'team' && currency === 'INR') {
			// US-2 AC1 — a clear escape hatch, never a silent currency redirect.
			return
		}
		void beginCheckout(plan)
	}

	const priceLabel = (plan: PlanDefinition): { headline: string; sub: string | null } => {
		if (plan.id === 'free') return { headline: 'Free', sub: null }
		if (plan.id === 'enterprise') return { headline: 'Custom', sub: null }
		if (plan.id === 'team' && currency === 'INR') {
			return { headline: 'USD only', sub: 'Team is billed in USD at launch' }
		}

		const isTeam = plan.id === 'team'
		const displayCurrency: BillingCurrency = isTeam ? 'USD' : currency
		const totalForCycle = isTeam
			? priceAmountMajor('team', cycle, 'USD', cohort)
			: priceAmountMajor(plan.id, cycle, currency, cohort)
		const monthlyAmount = isTeam
			? (cycle === 'annual' ? totalForCycle / 12 : totalForCycle)
			: cycle === 'annual'
				? totalForCycle / 12
				: totalForCycle
		const yearlyTotal = (isTeam ? totalForCycle : totalForCycle) * (cycle === 'annual' ? 1 : 12)

		return {
			headline: formatPrice(Number(monthlyAmount.toFixed(2)), displayCurrency),
			sub: isTeam
				? cycle === 'annual'
					? `billed annually at ${formatPrice(Number((totalForCycle * seats).toFixed(2)), displayCurrency)}/yr for ${seats} seats`
					: `${formatPrice(Number((totalForCycle * seats).toFixed(2)), displayCurrency)}/mo for ${seats} seats`
				: cycle === 'annual'
					? `billed annually at ${formatPrice(Number(yearlyTotal.toFixed(2)), displayCurrency)}/yr`
					: null,
		}
	}

	return (
		<div className="space-y-8 py-4 max-w-6xl mx-auto">
			<div className="flex flex-col sm:flex-row items-center justify-center gap-3">
				<div className="bg-black/5 dark:bg-white/10 p-1 rounded-2xl flex items-center gap-1 border border-black/10 dark:border-white/10 shadow-sm">
					<button
						type="button"
						onClick={() => setCategory('individual')}
						aria-pressed={category === 'individual'}
						className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${category === 'individual'
							? 'bg-primary text-on-primary shadow-md'
							: 'text-on-surface-variant hover:text-on-surface'
							}`}
					>
						Individual
					</button>
					<button
						type="button"
						onClick={() => setCategory('team')}
						aria-pressed={category === 'team'}
						className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${category === 'team'
							? 'bg-primary text-on-primary shadow-md'
							: 'text-on-surface-variant hover:text-on-surface'
							}`}
					>
						Team and Enterprise
					</button>
				</div>

				{/* US-2 AC1 — explicit currency switch with a country-derived default. */}
				<div
					role="group"
					aria-label="Billing currency"
					className="bg-black/5 dark:bg-white/10 p-1 rounded-2xl flex items-center gap-1 border border-black/10 dark:border-white/10"
				>
					<button
						type="button"
						onClick={() => setCurrency('INR')}
						aria-pressed={currency === 'INR'}
						className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${currency === 'INR' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
					>
						₹ INR
					</button>
					<button
						type="button"
						onClick={() => setCurrency('USD')}
						aria-pressed={currency === 'USD'}
						className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${currency === 'USD' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
					>
						$ USD
					</button>
				</div>
			</div>

			<p className="text-center text-[11px] text-on-surface-variant">
				{currency === 'INR'
					? 'Paying from India? UPI & cards via Razorpay. Team is USD-only — switch to USD to buy Team.'
					: 'International billing via Stripe. You can switch currency explicitly at any time.'}
			</p>

			<div className="flex items-center justify-center gap-3">
				<span className={`text-xs font-medium ${!isYearly ? 'text-on-surface font-bold' : 'text-on-surface-variant'}`}>Monthly</span>
				<button
					type="button"
					aria-label="Toggle Billing Cycle"
					aria-pressed={isYearly}
					onClick={() => setIsYearly(!isYearly)}
					className="relative w-12 h-6 rounded-full bg-black/15 dark:bg-white/15 border border-black/10 dark:border-white/10 shadow-inner p-0.5 transition-colors focus:outline-none"
				>
					<div className={`w-4 h-4 rounded-full bg-primary shadow-md border border-primary-container/20 transition-transform ${isYearly ? 'translate-x-6' : 'translate-x-0'}`} />
				</button>
				<div className="flex items-center gap-1.5">
					<span className={`text-xs font-medium ${isYearly ? 'text-on-surface font-bold' : 'text-on-surface-variant'}`}>Yearly</span>
					<span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
						2 months free
					</span>
				</div>
			</div>

			{category === 'team' && (
				<div className="flex items-center justify-center gap-3">
					<label htmlFor="team-seats" className="text-xs font-medium text-on-surface-variant">
						Seats
					</label>
					<select
						id="team-seats"
						value={seats}
						onChange={(event) => setSeats(Number(event.target.value))}
						className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 text-on-surface"
					>
						{Array.from({ length: TEAM_MAX_SEATS - TEAM_MIN_SEATS + 1 }, (_, index) => TEAM_MIN_SEATS + index).map((count) => (
							<option key={count} value={count}>
								{count} seats
							</option>
						))}
					</select>
					<span className="text-[11px] text-on-surface-variant">
						{formatPrice(Number(teamMonthlyTotal.toFixed(2)), 'USD')} / seat / month
					</span>
				</div>
			)}

			<div className={`grid gap-6 ${category === 'individual' ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto'}`}>
				{plansToDisplay.map((plan) => {
					const isCurrent = !isLandingPage && plan.id === currentPlan
					const price = priceLabel(plan)
					const teamBlockedByCurrency = plan.id === 'team' && currency === 'INR'
					const buttonLabel = isCurrent
						? 'Current Plan'
						: plan.id === 'free' && isLandingPage
							? 'Get started'
							: plan.buttonText

					return (
						<div
							key={plan.id}
							className={`relative p-6 md:p-8 rounded-3xl border transition-all ${plan.popular
								? 'bg-primary/5 dark:bg-primary-container/10 border-primary shadow-xl scale-[1.02]'
								: 'bg-white/5 dark:bg-surface-container-low border-black/10 dark:border-white/10'
								}`}
						>
							<div className="flex flex-col h-full">
								<div className="flex justify-between items-start mb-4">
									<div>
										<div className="flex items-center gap-2">
											<h3 className="text-xl font-display-md text-on-surface font-bold mb-1">{plan.name}</h3>
											{isFounding && plan.id !== 'free' && plan.id !== 'enterprise' && (
												<span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30">
													Founding price
												</span>
											)}
										</div>
										<p className="text-xs text-on-surface-variant min-h-[32px] leading-relaxed">{plan.tagline}</p>
									</div>
									{plan.userBadge && (
										<span className="text-[10px] font-bold text-on-surface-variant bg-black/5 dark:bg-white/10 px-2.5 py-1 rounded-full shrink-0 border border-black/5 dark:border-white/10">
											{plan.userBadge}
										</span>
									)}
								</div>

								<div className="my-6">
									<div className="flex items-baseline gap-1">
										<span className="text-4xl font-extrabold text-on-surface">{price.headline}</span>
										{plan.id !== 'free' && plan.id !== 'enterprise' && !teamBlockedByCurrency && (
											<span className="text-xs text-on-surface-variant font-medium">
												{plan.perSeat ? ' / seat / month' : ' / month'}
											</span>
										)}
									</div>
									<div className="h-[20px] mt-1 flex items-center">
										{price.sub ? (
											<p className="text-[11px] text-on-surface-variant/70 font-medium leading-none">{price.sub}</p>
										) : null}
									</div>
								</div>

								{teamBlockedByCurrency ? (
									<button
										type="button"
										onClick={() => setCurrency('USD')}
										className="w-full py-3 rounded-xl text-xs font-bold transition-all mb-8 shadow-sm bg-black/10 dark:bg-white/10 text-on-surface hover:bg-black/20 dark:hover:bg-white/20"
									>
										Pay internationally in USD
									</button>
								) : (
									<button
										type="button"
										onClick={() => handlePlanAction(plan)}
										disabled={isCurrent || pending === plan.id}
										className={`w-full py-3 rounded-xl text-xs font-bold transition-all mb-8 shadow-sm ${isCurrent
											? 'bg-black/10 dark:bg-white/10 text-on-surface-variant cursor-default'
											: plan.popular
												? 'bg-primary text-on-primary hover:bg-primary/90 shadow-md'
												: 'bg-black/10 dark:bg-white/10 text-on-surface hover:bg-black/20 dark:hover:bg-white/20'
											} disabled:opacity-60`}
									>
										{pending === plan.id ? 'Starting…' : buttonLabel}
									</button>
								)}

								{plan.cumulativeHeader && (
									<div className="text-xs font-bold text-on-surface mb-3 border-t border-black/5 dark:border-white/5 pt-4">
										{plan.cumulativeHeader}
									</div>
								)}

								<ul className="space-y-2 text-xs text-on-surface-variant border-t border-black/5 dark:border-white/5 pt-4">
									{plan.features.map((feat, i) => (
										<li key={i} className="flex items-start justify-between gap-2.5">
											<div className="flex items-start gap-2.5">
												<Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
												<span className="leading-tight">{feat}</span>
											</div>
										</li>
									))}
								</ul>
							</div>
						</div>
					)
				})}
			</div>

			<p className="text-center text-[11px] text-on-surface-variant max-w-2xl mx-auto leading-relaxed">
				{activeSubscription?.gateway === 'razorpay' ? (
					<>
						On UPI / cards (Razorpay), <strong>plan changes and monthly↔annual switches are scheduled for the end of the current period</strong>
						{' '}— the provider applies them then, and your paid remainder is honored. Cancelling keeps your plan until the period ends.
					</>
				) : (
					<>
						Changing plans on an active subscription: <strong>upgrades apply immediately and are prorated</strong>;
						<strong> downgrades and monthly↔annual switches apply at the end of the current period</strong>.
						Cancelling keeps your plan until the period ends — pages are never deleted.
					</>
				)}
			</p>
		</div>
	)
}
