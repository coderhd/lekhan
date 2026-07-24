'use client'

import { useState } from 'react'
import { Check, Users, Shield, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

export interface PricingPlan {
	id: string
	name: string
	priceMonthly: number | 'Custom'
	priceYearly?: number
	perSeat?: boolean
	badge?: string
	description: string
	credits: string
	editorCap: string
	history: string
	features: string[]
	buttonText: string
	popular?: boolean
}

export const PRICING_PLANS: PricingPlan[] = [
	{
		id: 'free',
		name: 'Free',
		priceMonthly: 0,
		description: 'For individuals starting out with smart collaborative note-taking.',
		credits: '50 Starter Credits + BYOK',
		editorCap: '2 Editors max / doc',
		history: '3 Days history',
		features: ['5 Documents max', 'Mentions (View-only)', 'Standard AI assistance', 'BYOK API Key support'],
		buttonText: 'Current Plan',
	},
	{
		id: 'go',
		name: 'Go',
		priceMonthly: 99,
		priceYearly: 79,
		description: 'For active creators needing more AI powers & collaborators.',
		credits: '500 Credits / mo + BYOK',
		editorCap: '5 Editors max / doc',
		history: '14 Days history',
		features: ['Unlimited Documents', 'Full Mentions support', 'Export to Markdown & PDF', 'BYOK fallback option'],
		buttonText: 'Upgrade to Go',
	},
	{
		id: 'pro',
		name: 'Pro',
		priceMonthly: 499,
		priceYearly: 399,
		popular: true,
		badge: 'Most Popular',
		description: 'For power users, researchers, and professional writers.',
		credits: '2,500 Credits / mo + BYOK',
		editorCap: '25 Editors max / doc',
		history: '90 Days history',
		features: ['Priority Sync server', 'Advanced AI Assistant', 'Priority Email Support', 'Full Version History'],
		buttonText: 'Upgrade to Pro',
	},
	{
		id: 'team',
		name: 'Team',
		priceMonthly: 499,
		priceYearly: 399,
		perSeat: true,
		description: 'For collaborative teams requiring centralized management.',
		credits: '3,500 Credits / seat / mo',
		editorCap: '50 Editors max / doc',
		history: '1 Year history',
		features: ['Centralized Team Billing', 'Admin Workspace Controls', 'Shared Team Templates', 'Dedicated Onboarding'],
		buttonText: 'Upgrade Team',
	},
	{
		id: 'enterprise',
		name: 'Enterprise',
		priceMonthly: 'Custom',
		description: 'Custom infrastructure & SLAs for large organizations.',
		credits: 'Custom / Unlimited',
		editorCap: 'Unlimited Editors',
		history: 'Unlimited history',
		features: ['Dedicated Render/Supabase instance', 'Custom SLA & Security', 'SSO / SAML authentication', 'Account Manager'],
		buttonText: 'Contact Sales',
	},
]

export default function PricingMatrix({ currentPlan = 'free' }: { currentPlan?: string }) {
	const [isYearly, setIsYearly] = useState(false)

	const handleUpgrade = (plan: PricingPlan) => {
		if (plan.id === currentPlan) return
		if (plan.id === 'enterprise') {
			toast.info('Thank you for your interest! Our enterprise sales team will reach out shortly.')
			return
		}
		toast.success(`Simulated Upgrade: Successfully upgraded to ${plan.name} plan!`)
	}

	return (
		<div className="space-y-8 py-4">
			{/* Billing Cycle Toggle */}
			<div className="flex items-center justify-center gap-4">
				<span className={`text-xs font-medium ${!isYearly ? 'text-on-surface font-bold' : 'text-on-surface-variant'}`}>Monthly Billing</span>
				<button
					type="button"
					aria-label="Toggle Yearly Billing"
					onClick={() => setIsYearly(!isYearly)}
					className="relative w-12 h-6 rounded-full bg-black/10 dark:bg-white/10 p-1 transition-colors focus:outline-none"
				>
					<div className={`w-4 h-4 rounded-full bg-primary transition-transform ${isYearly ? 'translate-x-6' : 'translate-x-0'}`} />
				</button>
				<div className="flex items-center gap-1.5">
					<span className={`text-xs font-medium ${isYearly ? 'text-on-surface font-bold' : 'text-on-surface-variant'}`}>Yearly Billing</span>
					<span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">Save 20%</span>
				</div>
			</div>

			{/* Pricing Cards Grid */}
			<div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
				{PRICING_PLANS.map((plan) => {
					const isCurrent = plan.id === currentPlan
					const price = typeof plan.priceMonthly === 'number'
						? isYearly && plan.priceYearly ? plan.priceYearly : plan.priceMonthly
						: plan.priceMonthly

					return (
						<div
							key={plan.id}
							className={`relative flex flex-col justify-between p-5 rounded-2xl border transition-all ${
								plan.popular
									? 'bg-primary/5 dark:bg-primary-container/10 border-primary shadow-md scale-[1.02]'
									: 'bg-white/5 dark:bg-surface-container-low border-black/10 dark:border-white/10'
							}`}
						>
							{plan.badge && (
								<div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow">
									{plan.badge}
								</div>
							)}

							<div>
								<h3 className="text-lg font-display-md text-on-surface mb-1">{plan.name}</h3>
								<p className="text-[11px] text-on-surface-variant min-h-[32px] mb-4 leading-tight">{plan.description}</p>

								<div className="mb-4">
									<span className="text-2xl font-bold text-on-surface">
										{typeof price === 'number' ? `₹${price}` : price}
									</span>
									{typeof price === 'number' && (
										<span className="text-xs text-on-surface-variant">
											{plan.perSeat ? ' / seat / mo' : ' / mo'}
										</span>
									)}
								</div>

								<div className="space-y-2 text-xs border-t border-black/5 dark:border-white/5 pt-3 mb-4">
									<div className="flex items-center gap-2 text-on-surface">
										<Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
										<span className="font-medium text-[11px]">{plan.credits}</span>
									</div>
									<div className="flex items-center gap-2 text-on-surface">
										<Users className="w-3.5 h-3.5 text-primary shrink-0" />
										<span className="text-[11px]">{plan.editorCap}</span>
									</div>
									<div className="flex items-center gap-2 text-on-surface">
										<Shield className="w-3.5 h-3.5 text-primary shrink-0" />
										<span className="text-[11px]">{plan.history}</span>
									</div>
								</div>

								<ul className="space-y-1.5 text-[11px] text-on-surface-variant mb-6">
									{plan.features.map((feat, i) => (
										<li key={i} className="flex items-center gap-2">
											<Check className="w-3 h-3 text-emerald-500 shrink-0" />
											<span>{feat}</span>
										</li>
									))}
								</ul>
							</div>

							<button
								type="button"
								onClick={() => handleUpgrade(plan)}
								disabled={isCurrent}
								className={`w-full py-2.5 rounded-xl text-xs font-medium transition-all ${
									isCurrent
										? 'bg-black/10 dark:bg-white/10 text-on-surface-variant cursor-default'
										: plan.popular
										? 'bg-primary text-on-primary hover:bg-primary/90 shadow'
										: 'bg-black/5 dark:bg-white/5 text-on-surface hover:bg-black/10 dark:hover:bg-white/10 border border-black/10 dark:border-white/10'
								}`}
							>
								{isCurrent ? 'Current Plan' : plan.buttonText}
							</button>
						</div>
					)
				})}
			</div>
		</div>
	)
}
