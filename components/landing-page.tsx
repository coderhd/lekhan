'use client'

import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { DownloadCloud, Users, WifiOff, Lock } from 'lucide-react'
import ThemeToggle from './theme-toggle'
import { useState, useEffect } from 'react'

export default function LandingPage() {
	const router = useRouter()
	const [theme, setTheme] = useState<'light' | 'dark'>('dark')

	useEffect(() => {
		if (typeof window !== 'undefined') {
			const savedTheme = (localStorage.getItem('theme') as 'light' | 'dark') || 'dark'
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

	return (
		<div className="bg-background text-on-surface selection:bg-primary-container/30 min-h-screen relative overflow-hidden transition-colors duration-300">
			{/* Top Navigation */}
			<nav className="fixed top-0 w-full bg-surface/5 backdrop-blur-xl border-b border-black/10 dark:border-white/10 z-50">
				<div className="flex justify-between items-center px-4 md:px-10 h-16 w-full max-w-[1200px] mx-auto">
					<div className="flex items-baseline group cursor-pointer" onClick={() => router.push('/')}>
						<img alt="Lekhan Logo" className="h-6 w-6 object-contain cursor-pointer hover:scale-110 transition-transform self-center" src="/logo.png" />
						<span className="font-display-lg text-xl md:text-2xl font-bold text-primary-container transition-colors group-hover:text-primary leading-none ml-[2px]">ekhan</span>
					</div>
					<div className="flex items-center gap-4">
						<ThemeToggle theme={theme} toggleTheme={toggleTheme} />
						<button 
							onClick={() => router.push('/login')}
							className="font-label-sm text-sm bg-primary-container text-on-primary font-bold px-6 py-2 rounded-lg hover:bg-primary transition-colors active:scale-95 shadow-sm"
						>
							Log In
						</button>
					</div>
				</div>
			</nav>
			
			<main className="pt-20">
				{/* Hero Section */}
				<section className="relative px-4 pt-20 pb-20 overflow-hidden flex flex-col items-center text-center min-h-[70vh] justify-center">
					<div className="hero-glow top-20 -left-20"></div>
					<div className="hero-glow bottom-0 -right-20"></div>
					
					<div className="inline-flex items-center gap-2 px-3 py-1 glass rounded-full mb-8">
						<span className="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
						<span className="text-label-sm font-label-sm text-on-surface-variant">LOCAL-FIRST EDITOR</span>
					</div>
					
					<h1 className="font-display-lg-mobile md:text-display-lg text-4xl md:text-6xl font-bold text-on-surface mb-6 max-w-2xl leading-tight">
						Elevate your <span className="text-primary-container">writing flow.</span>
					</h1>
					
					<p className="font-body-md text-body-md text-on-surface-variant mb-10 max-w-sm mx-auto">
						The premium, local-first collaborative editor for high-performance teams.
					</p>
					
					<div className="flex flex-col sm:flex-row w-full max-w-md gap-4 px-4 mx-auto justify-center">
						<button 
							onClick={() => router.push('/signup')}
							className="bg-primary-container text-on-primary font-label-sm text-label-sm px-6 py-4 rounded-lg font-bold tracking-wide active:scale-[0.98] transition-transform flex-1"
						>
							Get started
						</button>
						<button 
							onClick={() => router.push('/login')}
							className="glass text-on-surface font-label-sm text-label-sm px-6 py-4 rounded-lg font-semibold border border-white/10 active:scale-[0.98] transition-transform flex-1"
						>
							Log In
						</button>
					</div>
					
					{/* Collaboration Cursor Teaser */}
					<div className="mt-16 w-full max-w-sm glass aspect-video rounded-xl p-6 relative overflow-hidden flex flex-col justify-end items-start border border-white/5 mx-auto">
						<div className="absolute top-1/2 left-1/4 flex items-start gap-1">
							<div className="cursor-anim"></div>
							<div className="bg-primary-container px-2 py-0.5 rounded-sm">
								<span className="text-[10px] font-bold text-on-primary-container">Alex</span>
							</div>
						</div>
						<div className="space-y-3 w-full opacity-40">
							<div className="h-2 w-3/4 bg-white/20 rounded"></div>
							<div className="h-2 w-1/2 bg-white/20 rounded"></div>
							<div className="h-2 w-5/6 bg-white/20 rounded"></div>
						</div>
					</div>
				</section>

				{/* Features Grid */}
				<section className="px-4 pb-20 max-w-[1200px] mx-auto">
					<div className="mb-12 text-center md:text-left">
						<h2 className="font-headline-md text-3xl font-bold text-on-surface mb-2">Designed for focus.</h2>
						<p className="font-body-md text-body-md text-on-surface-variant">Experience the next generation of team collaboration.</p>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
						{/* Card 1 */}
						<div className="glass p-8 rounded-xl flex flex-col items-start transition-all hover:border-primary-container/30">
							<div className="w-12 h-12 rounded-lg bg-primary-container/10 flex items-center justify-center mb-6 text-primary-container">
								<DownloadCloud className="w-6 h-6" />
							</div>
							<h3 className="font-headline-md text-xl font-semibold text-on-surface mb-3">Local-First Sync</h3>
							<p className="font-body-md text-body-md text-on-surface-variant">Instant sync with data that stays on your device. Never wait for a loading spinner again.</p>
						</div>
						{/* Card 2 */}
						<div className="glass p-8 rounded-xl flex flex-col items-start transition-all hover:border-primary-container/30">
							<div className="w-12 h-12 rounded-lg bg-primary-container/10 flex items-center justify-center mb-6 text-primary-container">
								<Users className="w-6 h-6" />
							</div>
							<h3 className="font-headline-md text-xl font-semibold text-on-surface mb-3">Real-time Collab</h3>
							<p className="font-body-md text-body-md text-on-surface-variant">Work together seamlessly with zero-latency editing. See changes as they happen.</p>
						</div>
						{/* Card 3 */}
						<div className="glass p-8 rounded-xl flex flex-col items-start transition-all hover:border-primary-container/30">
							<div className="w-12 h-12 rounded-lg bg-primary-container/10 flex items-center justify-center mb-6 text-primary-container">
								<WifiOff className="w-6 h-6" />
							</div>
							<h3 className="font-headline-md text-xl font-semibold text-on-surface mb-3">Offline Mode</h3>
							<p className="font-body-md text-body-md text-on-surface-variant">Write anytime, anywhere. Your work is always accessible, even without an internet connection.</p>
						</div>
						{/* Card 4 */}
						<div className="glass p-8 rounded-xl flex flex-col items-start transition-all hover:border-primary-container/30">
							<div className="w-12 h-12 rounded-lg bg-primary-container/10 flex items-center justify-center mb-6 text-primary-container">
								<Lock className="w-6 h-6" />
							</div>
							<h3 className="font-headline-md text-xl font-semibold text-on-surface mb-3">Privacy by Design</h3>
							<p className="font-body-md text-body-md text-on-surface-variant">End-to-end encryption and complete data ownership. Your thoughts belong only to you.</p>
						</div>
					</div>
				</section>

				{/* Stats Section */}
				<section className="px-4 pb-20 text-center max-w-[1200px] mx-auto">
					<div className="glass py-12 px-6 rounded-2xl border border-primary-container/10">
						<div className="grid grid-cols-2 gap-8 max-w-2xl mx-auto">
							<div>
								<div className="font-display-lg-mobile md:text-5xl text-4xl font-bold text-primary-container mb-2">0ms</div>
								<div className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">Latency</div>
							</div>
							<div>
								<div className="font-display-lg-mobile md:text-5xl text-4xl font-bold text-primary-container mb-2">100%</div>
								<div className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">Ownership</div>
							</div>
						</div>
					</div>
				</section>

				{/* CTA Section */}
				<section className="px-4 pb-20 relative max-w-[1200px] mx-auto">
					<div className="bg-primary-container p-10 rounded-3xl text-center overflow-hidden relative">
						<div className="absolute inset-0 opacity-10 pointer-events-none">
							<div className="absolute top-0 left-0 w-full h-full" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
						</div>
						<h2 className="font-headline-md text-3xl font-bold text-on-primary mb-4">Ready to perform?</h2>
						<p className="font-body-md text-body-md text-on-primary-fixed-variant mb-8 max-w-md mx-auto">Join thousands of high-performance teams writing the future.</p>
						<button 
							onClick={() => router.push('/signup')}
							className="bg-surface text-primary-container font-label-sm text-label-sm px-8 py-4 rounded-lg font-bold uppercase active:scale-95 transition-transform relative z-10"
						>
							Get Started Now
						</button>
					</div>
				</section>
			</main>

			{/* Footer */}
			<footer className="bg-surface border-t border-white/5">
				<div className="flex flex-col md:flex-row justify-between items-center py-10 px-4 md:px-10 w-full max-w-[1200px] mx-auto space-y-8 md:space-y-0">
					<div className="flex flex-col items-center md:items-start gap-4">
						<div className="flex items-baseline group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
							<img alt="Lekhan Logo" className="h-6 w-6 object-contain cursor-pointer hover:scale-110 transition-transform self-center" src="/logo.png" />
							<span className="font-display-lg text-xl md:text-2xl font-bold text-primary-container transition-colors group-hover:text-primary leading-none ml-[2px]">ekhan</span>
						</div>
						<p className="font-body-md text-sm text-on-surface-variant text-center md:text-left max-w-xs">
							Designed for focused teams.
						</p>
					</div>
					<div className="flex gap-4">
						<a className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer p-2 bg-white/5 rounded-full" href="https://twitter.com/harshdave" target="_blank" rel="noopener noreferrer">
							<svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
								<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.004 3.985H5.078z" />
							</svg>
						</a>
						<a className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer p-2 bg-white/5 rounded-full" href="https://github.com/harshdave" target="_blank" rel="noopener noreferrer">
							<svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
								<path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
							</svg>
						</a>
						<a className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer p-2 bg-white/5 rounded-full" href="https://linkedin.com/in/harshdave" target="_blank" rel="noopener noreferrer">
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
