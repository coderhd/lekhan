'use client'

import { useRouter } from 'next/navigation'

import { DownloadCloud, Users, WifiOff, Lock } from 'lucide-react'
import ThemeToggle from './theme-toggle'
import { useEffect } from 'react'

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
			{/* Top Navigation */}
			<nav className="fixed top-0 w-full bg-surface/5 backdrop-blur-xl border-b border-black/10 dark:border-white/10 z-50">
				<div className="flex justify-between items-center px-6 md:px-10 h-16 w-full max-w-[1200px] mx-auto">
					<div className="flex items-center group cursor-pointer" onClick={() => router.push('/')}>
						<img alt="Lekhan Logo" className="h-6 w-6 md:h-7 md:w-7 object-contain cursor-pointer hover:scale-110 transition-transform" src="/logo.png" />
						<span className="font-display-lg text-xl md:text-2xl font-bold text-primary-container transition-colors group-hover:text-primary leading-none translate-y-[1px]">ekhan</span>
					</div>
					<div className="flex items-center gap-4">
						<ThemeToggle />
						<button
							onClick={() => router.push('/login')}
							className="font-label-sm text-sm bg-primary-container text-on-primary font-bold px-6 py-2 rounded-lg hover:bg-primary transition-colors active:scale-95 shadow-sm"
						>
							Log In
						</button>
					</div>
				</div>
			</nav>

			<main className="pt-16">
				{/* Hero Section */}
				<section className="relative px-6 md:px-10 pt-20 pb-20 overflow-hidden flex flex-col lg:flex-row items-center justify-center lg:justify-between min-h-[90vh] lg:min-h-[100svh] max-w-[1200px] mx-auto gap-12">
					<div className="hero-glow top-20 -left-20"></div>
					<div className="hero-glow bottom-0 -right-20"></div>

					<div className="flex-1 flex flex-col items-center lg:items-start text-center lg:text-left z-10">
						<div className="inline-flex items-center gap-2 px-3 py-1 glass rounded-full mb-8">
							<span className="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
							<span className="text-label-sm font-label-sm text-on-surface-variant">THE FUTURE OF COLLABORATION</span>
						</div>

						<h1 className="font-display-lg-mobile md:text-display-lg text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-on-surface mb-6 leading-[1.1]">
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
				<section className="px-6 md:px-10 py-24 md:py-32 max-w-[1200px] mx-auto relative z-10">
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

			{/* Footer */}
			<footer className="bg-surface border-t border-white/5">
				<div className="flex flex-col md:flex-row justify-between items-center py-10 px-6 md:px-10 w-full max-w-[1200px] mx-auto space-y-8 md:space-y-0">
					<div className="flex flex-col items-center md:items-start gap-4">
						<div className="flex items-center group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
							<img alt="Lekhan Logo" className="h-6 w-6 md:h-7 md:w-7 object-contain cursor-pointer hover:scale-110 transition-transform" src="/logo.png" />
							<span className="font-display-lg text-xl md:text-2xl font-bold text-primary-container transition-colors group-hover:text-primary leading-none translate-y-[1px]">ekhan</span>
						</div>
						<p className="font-body-md text-sm text-on-surface-variant text-center md:text-left max-w-xs">
							Designed for focused teams.
						</p>
					</div>
					<div className="flex gap-4">
						<a className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer p-2 bg-white/5 rounded-full" href="https://x.com/harshdave1094" target="_blank" rel="noopener noreferrer">
							<svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
								<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.004 3.985H5.078z" />
							</svg>
						</a>
						<a className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer p-2 bg-white/5 rounded-full" href="https://github.com/coderhd" target="_blank" rel="noopener noreferrer">
							<svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
								<path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
							</svg>
						</a>
						<a className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer p-2 bg-white/5 rounded-full" href="https://linkedin.com/in/harshdave95" target="_blank" rel="noopener noreferrer">
							<svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
								<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
							</svg>
						</a>
					</div>
				</div>
			</footer>
		</div>
	)
}
