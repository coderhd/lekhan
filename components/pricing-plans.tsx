'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { track } from '@/lib/analytics'

export interface PricingPlan {
	id: string
	name: string
	tagline: string
	priceMonthly: number | 'Custom'
	priceYearlyEffective?: number // e.g. 83 for Go, 417 for Pro
	yearlyTotal?: number // 999 for Go, 4999 for Pro
	perSeat?: boolean
	userBadge?: string
	cumulativeHeader?: string
	features: string[]
	buttonText: string
	popular?: boolean
}

export const INDIVIDUAL_PLANS: PricingPlan[] = [
	{
		id: 'free',
		name: 'Free',
		tagline: 'Smart collaborative note-taking for individuals.',
		priceMonthly: 0,
		cumulativeHeader: 'Generous features for everyone',
		buttonText: 'Current Plan',
		features: [
			'5 Documents maximum',
			'2 Collaborators max / document',
			'Mentions (View-only)',
			'50 Sarvam AI Credits / mo + BYOK',
			'Local-first offline sync',
		],
	},
	{
		id: 'go',
		name: 'Go',
		tagline: 'For active creators needing more AI powers & speed.',
		priceMonthly: 99,
		priceYearlyEffective: 83,
		yearlyTotal: 999,
		cumulativeHeader: 'Everything in Free, plus:',
		buttonText: 'Get Go plan',
		features: [
			'Unlimited Documents',
			'10 Collaborators max / document',
			'Full Mentions support (Owners & Editors)',
			'500 Sarvam AI Credits / mo + BYOK',
			'14-day Version History',
		],
	},
	{
		id: 'pro',
		name: 'Pro',
		tagline: 'Higher limits, priority access & advanced research.',
		priceMonthly: 499,
		priceYearlyEffective: 417,
		yearlyTotal: 4999,
		popular: true,
		cumulativeHeader: 'Everything in Go, plus:',
		buttonText: 'Get Pro plan',
		features: [
			'2,500 Sarvam AI Credits / mo + BYOK',
			'25 Collaborators max / document',
			'Priority Sync & Processing server',
			'90-day Version History',
			'Priority Email Support',
		],
	},
]

export const TEAM_ENTERPRISE_PLANS: PricingPlan[] = [
	{
		id: 'team',
		name: 'Team',
		tagline: 'Predictable usage per seat for growing teams.',
		priceMonthly: 499,
		priceYearlyEffective: 417,
		yearlyTotal: 4999,
		perSeat: true,
		userBadge: '2-150 users',
		cumulativeHeader: 'Everything in Pro, plus:',
		buttonText: 'Get Team plan',
		features: [
			'Centralized Team Billing & Admin controls',
			'3,500 Sarvam AI Credits / seat / mo',
			'50 Collaborators max / document',
			'Shared Team Templates & Workspaces',
			'1-Year Version History',
		],
	},
	{
		id: 'enterprise',
		name: 'Enterprise',
		tagline: 'Flexible pooled usage & dedicated infrastructure.',
		priceMonthly: 'Custom',
		userBadge: '20+ users',
		cumulativeHeader: 'All Team features, plus:',
		buttonText: 'Contact Sales',
		features: [
			'Dedicated Sarvam AI & Render instance',
			'Custom SLA & Enterprise Security',
			'SSO / SAML authentication',
			'Dedicated Account Manager',
			'Unlimited Version History & Collaborators',
		],
	},
]

export default function PricingMatrix({
	currentPlan = 'free',
	isLandingPage = false,
}: {
	currentPlan?: string
	isLandingPage?: boolean
}) {
	const router = useRouter()
	const [category, setCategory] = useState<'individual' | 'team'>('individual')
	const [isYearly, setIsYearly] = useState(true)

	const handleUpgrade = (plan: PricingPlan) => {
		if (!isLandingPage && plan.id === currentPlan) return
		track('upgrade_clicked', {
			plan: plan.id,
			billing_cycle: isYearly ? 'yearly' : 'monthly',
		})
		// Real billing ships with #29 (Stripe + Razorpay). Until then every plan
		// CTA routes to signup — the page must never fake a purchase.
		if (plan.id === 'enterprise') {
			router.push('/contact')
			return
		}
		router.push('/signup')
	}

	const plansToDisplay = category === 'individual' ? INDIVIDUAL_PLANS : TEAM_ENTERPRISE_PLANS

	return (
		<div className="space-y-8 py-4 max-w-6xl mx-auto">
			{/* Top Category Segmented Switcher */}
			<div className="flex justify-center">
				<div className="bg-black/5 dark:bg-white/10 p-1 rounded-2xl flex items-center gap-1 border border-black/10 dark:border-white/10 shadow-sm">
					<button
						type="button"
						onClick={() => setCategory('individual')}
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
						className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${category === 'team'
							? 'bg-primary text-on-primary shadow-md'
							: 'text-on-surface-variant hover:text-on-surface'
							}`}
					>
						Team and Enterprise
					</button>
				</div>
			</div>

			{/* Sub-Header Billing Toggle for Paid Plans */}
			<div className="flex items-center justify-center gap-3">
				<span className={`text-xs font-medium ${!isYearly ? 'text-on-surface font-bold' : 'text-on-surface-variant'}`}>Monthly</span>
				<button
					type="button"
					aria-label="Toggle Billing Cycle"
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

			{/* Pricing Grid */}
			<div className={`grid gap-6 ${category === 'individual' ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto'}`}>
				{plansToDisplay.map((plan) => {
					const isCurrent = !isLandingPage && plan.id === currentPlan
					const hasYearlyOption = typeof plan.priceMonthly === 'number' && plan.priceMonthly > 0
					const displayedPrice = hasYearlyOption && isYearly ? plan.priceYearlyEffective : plan.priceMonthly
					const buttonLabel = isLandingPage && plan.id === 'free' ? 'Get started' : isCurrent ? 'Current Plan' : plan.buttonText

					return (
						<div
							key={plan.id}
							className={`relative p-6 md:p-8 rounded-3xl border transition-all ${plan.popular
								? 'bg-primary/5 dark:bg-primary-container/10 border-primary shadow-xl scale-[1.02]'
								: 'bg-white/5 dark:bg-surface-container-low border-black/10 dark:border-white/10'
								}`}
						>
							<div className="flex flex-col h-full">
								{/* Header & Badges */}
								<div className="flex justify-between items-start mb-4">
									<div>
										<h3 className="text-xl font-display-md text-on-surface font-bold mb-1">{plan.name}</h3>
										<p className="text-xs text-on-surface-variant min-h-[32px] leading-relaxed">{plan.tagline}</p>
									</div>
									{plan.userBadge && (
										<span className="text-[10px] font-bold text-on-surface-variant bg-black/5 dark:bg-white/10 px-2.5 py-1 rounded-full shrink-0 border border-black/5 dark:border-white/10">
											{plan.userBadge}
										</span>
									)}
								</div>

								{/* Pricing */}
								<div className="my-6">
									<div className="flex items-baseline gap-1">
										<span className="text-4xl font-extrabold text-on-surface">
											{typeof displayedPrice === 'number' ? `₹${displayedPrice}` : displayedPrice}
										</span>
										{typeof displayedPrice === 'number' && (
											<span className="text-xs text-on-surface-variant font-medium">
												{plan.perSeat ? ' / seat / month' : ' / month'}
											</span>
										)}
									</div>

									{/* Reserved height wrapper prevents layout shift when toggling Monthly/Yearly */}
									<div className="h-[20px] mt-1 flex items-center">
										{hasYearlyOption && isYearly && plan.yearlyTotal ? (
											<p className="text-[11px] text-on-surface-variant/70 font-medium leading-none">
												billed annually at ₹{plan.yearlyTotal.toLocaleString()}/yr
											</p>
										) : null}
									</div>
								</div>

								{/* CTA Button */}
								<button
									type="button"
									onClick={() => handleUpgrade(plan)}
									disabled={isCurrent}
									className={`w-full py-3 rounded-xl text-xs font-bold transition-all mb-8 shadow-sm ${isCurrent
										? 'bg-black/10 dark:bg-white/10 text-on-surface-variant cursor-default'
										: plan.popular
											? 'bg-primary text-on-primary hover:bg-primary/90 shadow-md'
											: 'bg-black/10 dark:bg-white/10 text-on-surface hover:bg-black/20 dark:hover:bg-white/20'
										}`}
								>
									{buttonLabel}
								</button>

								{/* Cumulative Features Header */}
								{plan.cumulativeHeader && (
									<div className="text-xs font-bold text-on-surface mb-3 border-t border-black/5 dark:border-white/5 pt-4">
										{plan.cumulativeHeader}
									</div>
								)}

								{/* Feature List */}
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
		</div>
	)
}
