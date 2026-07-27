'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'


import Link from 'next/link'
import { DownloadCloud, Users, WifiOff, Lock } from 'lucide-react'
import ThemeToggle from './theme-toggle'
import PricingMatrix from './pricing-plans'
import { GlobalHeaderSlot } from './layout/global-header-context'


export default function LandingPage() {
	const router = useRouter()


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



	return (
		<div className="bg-background text-on-surface selection:bg-primary-container/30 min-h-screen relative overflow-hidden transition-colors duration-300">
			<GlobalHeaderSlot slot="right">
					<div className="flex items-center gap-6">
						<Link
							href="/#features"
							className="hidden md:block text-xs text-on-surface-variant hover:text-on-surface transition-colors font-medium"
						>
							Features
						</Link>
						<Link
							href="/faq"
							className="hidden md:block text-xs text-on-surface-variant hover:text-on-surface transition-colors font-medium"
						>
							FAQ
						</Link>
						<ThemeToggle />
						<button
							onClick={() => router.push('/login')}
							className="font-label-sm text-xs bg-primary-container text-on-primary-fixed font-bold px-4 py-2 rounded-lg hover:bg-primary transition-colors active:scale-95 shadow-sm"
						>
							Log In
						</button>
					</div>
			</GlobalHeaderSlot>

			<main className="pt-8">
				{/* Hero Section */}
				<section className="relative px-6 md:px-10 pt-20 pb-20 overflow-hidden flex flex-col lg:flex-row items-center justify-center lg:justify-between min-h-[90vh] lg:min-h-[100svh] max-w-[1200px] mx-auto gap-12">
					<div className="hero-glow top-20 -left-20"></div>
					<div className="hero-glow bottom-0 -right-20"></div>

					<div className="flex-1 flex flex-col items-center lg:items-start text-center lg:text-left z-10">
						<div className="inline-flex items-center gap-2 px-3 py-1 glass rounded-full mb-8">
							<span className="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
							<span className="text-label-sm font-label-sm text-on-surface-variant">THE FUTURE OF COLLABORATION</span>
						</div>

						<h1 className="font-display-lg-mobile md:text-display-lg text-4xl sm:text-5xl md:text-6xl lg:text-[64px] font-bold text-on-surface mb-6 leading-[1.1]">
							Write together, <br className="hidden md:block" />
							<span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-container to-primary">without limits.</span>
						</h1>

						<p className="text-md md:text-xl text-on-surface-variant mb-10 max-w-lg">
							Lekhan is a premium, local-first editor designed to keep high-performance teams in sync. Lightning fast, offline capable, and fiercely private.
						</p>

						<div className="flex flex-col sm:flex-row w-full sm:w-auto gap-4">
							<button
								onClick={() => router.push('/signup')}
								className="bg-primary-container text-on-primary text-base px-8 py-4 rounded-xl font-bold tracking-wide active:scale-[0.98] hover:shadow-lg hover:shadow-primary-container/20 transition-all"
							>
								Start Writing Free
							</button>
							<button
								onClick={() => {
									const el = document.getElementById('how-it-works')
									if (el) el.scrollIntoView({ behavior: 'smooth' })
								}}
								className="glass text-on-surface text-base px-8 py-4 rounded-xl font-semibold border border-white/10 active:scale-[0.98] hover:bg-white/5 transition-all"
							>
								How it works
							</button>
						</div>
					</div>

					<div className="flex-1 w-full max-w-lg md:max-w-none relative z-10">
						<img src="/hero-illustration.svg" alt="Team Collaboration" className="w-full h-auto drop-shadow-2xl animate-fade-in-up" />
					</div>
				</section>

				{/* How it works Section */}
				<section id="how-it-works" className="px-6 md:px-10 py-24 md:py-32 max-w-[1200px] mx-auto relative z-10">
					<div className="mb-24 text-center">
						<h2 className="font-display-md text-3xl md:text-4xl font-bold text-on-surface mb-4">How Lekhan works</h2>
						<p className="text-xl text-on-surface-variant max-w-2xl mx-auto">A seamless workflow designed to get out of your way.</p>
					</div>

					<div className="flex flex-col gap-24 lg:gap-32">
						{/* Step 1 */}
						<div className="flex flex-col md:flex-row items-center gap-12 lg:gap-20">
							<div className="flex-1 w-full relative group">
								<div className="absolute inset-0 bg-primary-container/10 rounded-[2.5rem] transform -rotate-3 transition-transform duration-500 group-hover:rotate-0"></div>
								<img src="/step-1.svg" alt="Create & Write" className="relative w-full h-auto max-w-lg mx-auto object-contain z-10 p-4 md:p-8 rounded-[2.5rem] animate-fade-in-up" />
							</div>
							<div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left z-10">
								<div className="w-16 h-16 rounded-full bg-surface border-4 border-primary-container/20 flex items-center justify-center mb-6 shadow-xl text-2xl font-bold text-primary-container">
									1
								</div>
								<h3 className="font-headline-md text-3xl font-bold text-on-surface mb-4">Create & Write</h3>
								<p className="text-lg text-on-surface-variant leading-relaxed">Start a new document instantly. No loading screens, no waiting. Your words are saved locally the moment you type.</p>
							</div>
						</div>

						{/* Step 2 */}
						<div className="flex flex-col md:flex-row-reverse items-center gap-12 lg:gap-20">
							<div className="flex-1 w-full relative group">
								<div className="absolute inset-0 bg-primary-container/10 rounded-[2.5rem] transform rotate-3 transition-transform duration-500 group-hover:rotate-0"></div>
								<img src="/step-2.svg" alt="Invite Collaborators" className="relative w-full h-auto max-w-lg mx-auto object-contain z-10 p-4 md:p-8 rounded-[2.5rem] animate-fade-in-up" style={{ animationDelay: '200ms' }} />
							</div>
							<div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left z-10">
								<div className="w-16 h-16 rounded-full bg-surface border-4 border-primary-container/20 flex items-center justify-center mb-6 shadow-xl text-2xl font-bold text-primary-container">
									2
								</div>
								<h3 className="font-headline-md text-3xl font-bold text-on-surface mb-4">Invite Collaborators</h3>
								<p className="text-lg text-on-surface-variant leading-relaxed">Share your document with team members. They can join instantly and see your changes in real-time, zero latency.</p>
							</div>
						</div>

						{/* Step 3 */}
						<div className="flex flex-col md:flex-row items-center gap-12 lg:gap-20">
							<div className="flex-1 w-full relative group">
								<div className="absolute inset-0 bg-primary-container/10 rounded-[2.5rem] transform -rotate-3 transition-transform duration-500 group-hover:rotate-0"></div>
								<img src="/step-3.svg" alt="Sync Seamlessly" className="relative w-full h-auto max-w-lg mx-auto object-contain z-10 p-4 md:p-8 rounded-[2.5rem] animate-fade-in-up" style={{ animationDelay: '400ms' }} />
							</div>
							<div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left z-10">
								<div className="w-16 h-16 rounded-full bg-surface border-4 border-primary-container/20 flex items-center justify-center mb-6 shadow-xl text-2xl font-bold text-primary-container">
									3
								</div>
								<h3 className="font-headline-md text-3xl font-bold text-on-surface mb-4">Sync Seamlessly</h3>
								<p className="text-lg text-on-surface-variant leading-relaxed">Go offline? No problem. Keep writing, and Lekhan will automatically merge everyone's changes when you reconnect.</p>
							</div>
						</div>
					</div>
				</section>

				{/* Features Grid */}
				<section id="features" className="px-6 md:px-10 py-24 md:py-32 max-w-[1200px] mx-auto relative z-10">
					<div className="mb-16 text-center md:text-left">
						<h2 className="font-display-md text-3xl md:text-4xl font-bold text-on-surface mb-4">Engineered for focus and speed.</h2>
						<p className="text-xl text-on-surface-variant max-w-2xl">Experience the next generation of team collaboration where your thoughts flow uninterrupted.</p>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
						{/* Card 1 */}
						<div className="glass p-8 rounded-2xl flex flex-col items-start transition-all hover:border-primary-container/40 hover:-translate-y-1">
							<div className="w-14 h-14 rounded-xl bg-primary-container/10 flex items-center justify-center mb-6 text-primary-container shadow-inner">
								<DownloadCloud className="w-7 h-7" />
							</div>
							<h3 className="font-headline-md text-xl font-bold text-on-surface mb-3">Local-First Architecture</h3>
							<p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">Changes are saved to your device instantly and synced quietly in the background. Never stare at a loading spinner again.</p>
						</div>
						{/* Card 2 */}
						<div className="glass p-8 rounded-2xl flex flex-col items-start transition-all hover:border-primary-container/40 hover:-translate-y-1">
							<div className="w-14 h-14 rounded-xl bg-primary-container/10 flex items-center justify-center mb-6 text-primary-container shadow-inner">
								<Users className="w-7 h-7" />
							</div>
							<h3 className="font-headline-md text-xl font-bold text-on-surface mb-3">Real-Time Multiplayer</h3>
							<p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">Collaborate with colleagues seamlessly. See cursors dance across the screen with zero-latency updates.</p>
						</div>
						{/* Card 3 */}
						<div className="glass p-8 rounded-2xl flex flex-col items-start transition-all hover:border-primary-container/40 hover:-translate-y-1">
							<div className="w-14 h-14 rounded-xl bg-primary-container/10 flex items-center justify-center mb-6 text-primary-container shadow-inner">
								<WifiOff className="w-7 h-7" />
							</div>
							<h3 className="font-headline-md text-xl font-bold text-on-surface mb-3">True Offline Mode</h3>
							<p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">Inspiration doesn't require Wi-Fi. Write anywhere, anytime, and we'll handle the syncing when you reconnect.</p>
						</div>
						{/* Card 4 */}
						<div className="glass p-8 rounded-2xl flex flex-col items-start transition-all hover:border-primary-container/40 hover:-translate-y-1">
							<div className="w-14 h-14 rounded-xl bg-primary-container/10 flex items-center justify-center mb-6 text-primary-container shadow-inner">
								<Lock className="w-7 h-7" />
							</div>
							<h3 className="font-headline-md text-xl font-bold text-on-surface mb-3">Privacy by Design</h3>
							<p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">Your data is yours. With robust security and complete ownership, your thoughts remain exclusively in your control.</p>
						</div>
					</div>
				</section>

				{/* Stats Section */}
				<section className="px-6 md:px-10 py-24 md:py-32 text-center max-w-[1200px] mx-auto relative z-10">
					<div className="glass py-16 px-8 rounded-[2.5rem] border border-primary-container/20 relative overflow-hidden">
						<div className="absolute inset-0 bg-gradient-to-r from-primary-container/5 to-transparent pointer-events-none"></div>
						<div className="grid grid-cols-1 md:grid-cols-3 gap-10 max-w-4xl mx-auto relative z-10">
							<div>
								<div className="font-display-lg md:text-6xl text-5xl font-bold text-primary-container mb-3 drop-shadow-sm">0ms</div>
								<div className="text-label-md font-bold text-on-surface-variant uppercase tracking-widest">Typing Latency</div>
							</div>
							<div>
								<div className="font-display-lg md:text-6xl text-5xl font-bold text-primary-container mb-3 drop-shadow-sm">100%</div>
								<div className="text-label-md font-bold text-on-surface-variant uppercase tracking-widest">Data Ownership</div>
							</div>
							<div>
								<div className="font-display-lg md:text-6xl text-5xl font-bold text-primary-container mb-3 drop-shadow-sm">24/7</div>
								<div className="text-label-md font-bold text-on-surface-variant uppercase tracking-widest">Offline Access</div>
							</div>
						</div>
					</div>
				</section>

				{/* Pricing Section */}
				<section id="pricing" className="px-6 md:px-10 py-24 md:py-32 max-w-[1400px] mx-auto relative z-10">
					<div className="mb-16 text-center">
						<h2 className="font-display-md text-3xl md:text-4xl font-bold text-on-surface mb-4">Simple, transparent pricing.</h2>
						<p className="text-xl text-on-surface-variant max-w-2xl mx-auto">Choose the tier that matches your collaborative writing scale.</p>
					</div>
					<PricingMatrix isLandingPage={true} />
				</section>

				{/* CTA Section */}
				<section className="px-6 md:px-10 py-24 md:py-32 relative max-w-[1200px] mx-auto z-10">
					<div className="bg-primary-container p-8 md:p-16 rounded-[2.5rem] text-center overflow-hidden relative shadow-2xl shadow-primary-container/20">
						<div className="absolute inset-0 opacity-10 pointer-events-none">
							<div className="absolute top-0 left-0 w-full h-full" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1.5px, transparent 0)', backgroundSize: '32px 32px' }}></div>
						</div>
						<h2 className="font-display-md text-3xl sm:text-4xl md:text-5xl font-bold text-on-primary mb-6">Ready to do your best work?</h2>
						<p className="text-lg md:text-xl text-on-primary-fixed-variant mb-10 max-w-2xl mx-auto">Join forward-thinking teams who have already upgraded their writing workflow.</p>
						<button
							onClick={() => router.push('/signup')}
							className="bg-surface text-primary-container text-base md:text-lg px-6 py-4 md:px-10 md:py-5 rounded-xl font-bold active:scale-95 hover:shadow-xl transition-all relative z-10 w-full sm:w-auto"
						>
							Start Collaborating Now
						</button>
					</div>
				</section>
			</main>
		</div>
	)
}
