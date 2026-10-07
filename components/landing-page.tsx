'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { DownloadCloud, Users, FolderInput, KeyRound } from 'lucide-react'
import ThemeToggle from './theme-toggle'
import { GlobalHeaderSlot } from './layout/global-header-context'

// Designed as — Lekhan public marketing · system: DESIGN.md (incumbent Material/Inter stack, cream/teak)
// Hallmark · macrostructure: Workbench (asymmetric remix) · genre: editorial · theme: brand-locked · proof: real screenshots (public/early/)

export default function LandingPage () {

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
		<div className="bg-background text-on-surface selection:bg-primary-container/30 min-h-screen relative transition-colors duration-300">
			<GlobalHeaderSlot slot="main">
				<Link
					href="/#features"
					className="text-xs text-on-surface-variant hover:text-on-surface transition-colors font-medium flex items-center min-h-[44px] focus-visible:outline focus-visible:ring-2 focus-visible:ring-primary"
				>
					Features
				</Link>
				<Link
					href="/faq"
					className="text-xs text-on-surface-variant hover:text-on-surface transition-colors font-medium flex items-center min-h-[44px] focus-visible:outline focus-visible:ring-2 focus-visible:ring-primary"
				>
					FAQ
				</Link>
				<Link
					href="/early?ref=site"
					className="text-xs font-semibold text-primary-ink hover:text-primary transition-colors flex items-center min-h-[44px] focus-visible:outline focus-visible:ring-2 focus-visible:ring-primary"
				>
					Founding Edition
				</Link>
			</GlobalHeaderSlot>
			<GlobalHeaderSlot slot="right">
				<div className="flex items-center gap-4">
					<ThemeToggle />
					<Link
						href="/login"
						className="font-label-sm text-xs bg-primary-container text-on-primary-fixed font-bold px-4 py-2.5 rounded-lg hover:bg-primary transition-colors active:scale-95 shadow-sm whitespace-nowrap focus-visible:outline focus-visible:ring-2 focus-visible:ring-primary"
					>
						Log In
					</Link>
				</div>
			</GlobalHeaderSlot>

			<div className="pt-8">
				{/* Hero — asymmetric, content-height: 7-col thesis / 5-col real editor shot */}
				<section className="relative px-6 md:px-10 pt-16 md:pt-24 pb-12 max-w-[1200px] mx-auto flex flex-col lg:grid lg:grid-cols-12 gap-10 lg:gap-12">
					<div className="lg:col-span-7 flex flex-col items-center lg:items-start text-center lg:text-left min-w-0 animate-fade-in-up">
						<div className="inline-flex items-center gap-2 px-3 py-1 glass rounded-full mb-8">
							<span className="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
							<span className="text-label-sm font-label-sm text-on-surface-variant">Founding edition now open · 500 numbered spots</span>
						</div>

						<h1 className="font-display-lg-mobile md:text-display-lg text-4xl sm:text-5xl md:text-6xl lg:text-[64px] font-bold text-on-surface mb-6 leading-[1.1] min-w-0 break-words">
							Your notes, <br className="hidden md:block" />
							on your disk. Now multiplayer.
						</h1>

						<p className="text-md md:text-xl text-on-surface-variant mb-10 max-w-xl">
							Local-first like Obsidian, collaborative like Notion — and every AI
							feature runs on your keys, in your browser, never on our servers.
							Your notes stay markdown files on your disk.
						</p>

						<div className="flex flex-col sm:flex-row w-full sm:w-auto gap-4">
							<Link
								href="/early?ref=hero"
								className="inline-flex items-center justify-center whitespace-nowrap bg-primary-container text-on-primary text-base px-8 py-4 rounded-xl font-bold tracking-wide active:scale-[0.98] hover:bg-primary transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-primary"
							>
								Claim your founding spot
							</Link>
							<button
								onClick={() => {
									const el = document.getElementById('how-it-works')
									if (!el) return
									const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
									el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' })
								}}
								className="glass text-on-surface text-base px-8 py-4 rounded-xl font-semibold border border-white/10 active:scale-[0.98] hover:bg-white/5 transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-primary"
							>
								How it works
							</button>
							<p className="text-xs text-on-surface-variant mt-1 w-full sm:w-auto text-center sm:text-left">
								Start free · No credit card · Export anytime
							</p>
						</div>
					</div>

					<div className="lg:col-span-5 w-full min-w-0 animate-fade-in-up" style={{ animationDelay: '150ms' }}>
						<figure className="rounded-lg border border-border/60 overflow-hidden shadow-sm">
							<img
								src="/early/shot-editor.png"
								alt="The Lekhan editor with pages as markdown files and a collaborator editing live"
								className="w-full h-auto"
							/>
							<figcaption className="text-xs text-on-surface-variant px-4 py-3 border-t border-border/60">
								The actual editor — markdown in, multiplayer on.
							</figcaption>
						</figure>
					</div>
				</section>

				{/* Proof strip — three real, checkable facts; hairline rules, no slab */}
				<section className="border-y border-border/40">
					<div className="max-w-[1200px] mx-auto px-6 md:px-10 grid grid-cols-1 sm:grid-cols-3 gap-x-10 gap-y-8 py-12">
						<div>
							<div className="font-display-lg text-5xl md:text-6xl font-bold text-primary-ink mb-2 tabular-nums">4</div>
							<p className="text-label-md font-bold text-on-surface-variant uppercase tracking-widest">Export formats, always free</p>
							<p className="text-sm text-on-surface-variant mt-1">Markdown, HTML, PDF, DOCX</p>
						</div>
						<div className="sm:border-l sm:border-border/40 sm:pl-10">
							<div className="font-display-lg text-5xl md:text-6xl font-bold text-primary-ink mb-2 tabular-nums">0</div>
							<p className="text-label-md font-bold text-on-surface-variant uppercase tracking-widest">Servers hosting your AI</p>
							<p className="text-sm text-on-surface-variant mt-1">BYOK, browser-direct</p>
						</div>
						<div className="sm:border-l sm:border-border/40 sm:pl-10">
							<div className="font-display-lg text-5xl md:text-6xl font-bold text-primary-ink mb-2 tabular-nums">500</div>
							<p className="text-label-md font-bold text-on-surface-variant uppercase tracking-widest">Numbered founding spots</p>
							<p className="text-sm text-on-surface-variant mt-1">Price locked for life</p>
						</div>
					</div>
				</section>

				{/* Features — asymmetric 12-col: 7/5 then 7/5, icon inline with heading, one hover signal */}
				<section id="features" className="px-6 md:px-10 py-20 md:py-28 max-w-[1200px] mx-auto">
					<div className="mb-12 md:mb-16 text-center md:text-left">
						<h2 className="font-display-md text-3xl md:text-4xl font-bold text-on-surface mb-4">Built for people who own their notes.</h2>
						<p className="text-xl text-on-surface-variant max-w-2xl">Your vault in. Four formats out. AI that never touches our servers.</p>
					</div>
					<div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
						{/* Card 1 */}
						<div className="glass p-8 rounded-xl flex flex-col items-start lg:col-span-7 transition-colors hover:border-primary-container/40">
							<div className="flex items-center gap-3 mb-4">
								<span className="w-10 h-10 rounded-lg bg-primary-container/10 flex items-center justify-center text-primary-ink">
									<DownloadCloud className="w-5 h-5" />
								</span>
								<h3 className="font-headline-md text-xl font-bold text-on-surface">Your Files Stay Files</h3>
							</div>
							<p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">Pages live as markdown on your disk. Round-trip export in four formats — markdown, HTML, PDF, DOCX. Leaving is an export button, not a migration project.</p>
						</div>
						{/* Card 2 */}
						<div className="glass p-8 rounded-xl flex flex-col items-start lg:col-span-5 transition-colors hover:border-primary-container/40">
							<div className="flex items-center gap-3 mb-4">
								<span className="w-10 h-10 rounded-lg bg-primary-container/10 flex items-center justify-center text-primary-ink">
									<Users className="w-5 h-5" />
								</span>
								<h3 className="font-headline-md text-xl font-bold text-on-surface">Multiplayer Over CRDTs</h3>
							</div>
							<p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">See each other's cursors in real time on shared pages. Editing keeps working through dropouts — changes merge automatically on reconnect, no data lost.</p>
						</div>
						{/* Card 3 — real import screenshot grounds the fidelity claim */}
						<div className="glass p-8 rounded-xl flex flex-col items-start lg:col-span-7 transition-colors hover:border-primary-container/40">
							<div className="flex items-center gap-3 mb-4">
								<span className="w-10 h-10 rounded-lg bg-primary-container/10 flex items-center justify-center text-primary-ink">
									<FolderInput className="w-5 h-5" />
								</span>
								<h3 className="font-headline-md text-xl font-bold text-on-surface">Import That Preserves Your Vault</h3>
							</div>
							<p className="font-body-md text-body-md text-on-surface-variant leading-relaxed mb-6">Import your Obsidian vault faithfully — wikilinks, callouts, frontmatter, tags included. You get a fidelity report honest about anything it couldn't map.</p>
							<figure className="w-full rounded-lg border border-border/60 overflow-hidden">
								<img
									src="/early/shot-import.png"
									alt="Lekhan importing an Obsidian vault, showing the mapping report"
									className="w-full h-auto"
								/>
							</figure>
						</div>
						{/* Card 4 */}
						<div className="glass p-8 rounded-xl flex flex-col items-start lg:col-span-5 transition-colors hover:border-primary-container/40">
							<div className="flex items-center gap-3 mb-4">
								<span className="w-10 h-10 rounded-lg bg-primary-container/10 flex items-center justify-center text-primary-ink">
									<KeyRound className="w-5 h-5" />
								</span>
								<h3 className="font-headline-md text-xl font-bold text-on-surface">AI on Your Own Keys</h3>
							</div>
							<p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">Bring your own key and run AI browser-direct against it. Lekhan never hosts the inference and never meters credits — the AI bill stays yours and yours alone.</p>
						</div>
					</div>
				</section>

				{/* How it works — typographic numbered workbench, no stock illustration */}
				<section id="how-it-works" className="px-6 md:px-10 py-20 md:py-28 max-w-[1200px] mx-auto">
					<div className="mb-12 md:mb-16 text-center md:text-left">
						<h2 className="font-display-md text-3xl md:text-4xl font-bold text-on-surface mb-4">How Lekhan works</h2>
						<p className="text-xl text-on-surface-variant max-w-2xl">Three steps, no workflow theatre.</p>
					</div>
					<div>
						{/* Step 1 */}
						<div className="grid grid-cols-[48px_1fr] sm:grid-cols-[72px_1fr] gap-5 sm:gap-8 py-8 sm:py-10 border-t border-border/40 min-w-0">
							<div className="font-display-lg text-3xl sm:text-5xl font-bold text-primary-ink tabular-nums leading-none">1</div>
							<div className="min-w-0">
								<h3 className="font-headline-md text-2xl font-bold text-on-surface mb-3">Create & Write</h3>
								<p className="text-lg text-on-surface-variant leading-relaxed max-w-2xl">Start a new document instantly. No loading screens, no waiting. Your words are saved locally the moment you type.</p>
							</div>
						</div>
						{/* Step 2 */}
						<div className="grid grid-cols-[48px_1fr] sm:grid-cols-[72px_1fr] gap-5 sm:gap-8 py-8 sm:py-10 border-t border-border/40 min-w-0">
							<div className="font-display-lg text-3xl sm:text-5xl font-bold text-primary-ink tabular-nums leading-none">2</div>
							<div className="min-w-0">
								<h3 className="font-headline-md text-2xl font-bold text-on-surface mb-3">Invite Collaborators</h3>
								<p className="text-lg text-on-surface-variant leading-relaxed max-w-2xl">Share your document with a link. They join instantly and see each keystroke as it happens.</p>
							</div>
						</div>
						{/* Step 3 */}
						<div className="grid grid-cols-[48px_1fr] sm:grid-cols-[72px_1fr] gap-5 sm:gap-8 py-8 sm:py-10 border-y border-border/40 min-w-0">
							<div className="font-display-lg text-3xl sm:text-5xl font-bold text-primary-ink tabular-nums leading-none">3</div>
							<div className="min-w-0">
								<h3 className="font-headline-md text-2xl font-bold text-on-surface mb-3">Pick Up Anywhere</h3>
								<p className="text-lg text-on-surface-variant leading-relaxed max-w-2xl">Go offline and keep writing. Lekhan merges everyone's changes automatically when you reconnect.</p>
							</div>
						</div>
					</div>
				</section>

				{/* CTA slab — brand slab stays; dot-grid texture cut for restraint */}
				<section className="px-6 md:px-10 py-20 md:py-28 max-w-[1200px] mx-auto">
					<div className="bg-primary-container p-8 md:p-16 rounded-[2.5rem] text-center relative">
						<h2 className="font-display-md text-3xl sm:text-4xl md:text-5xl font-bold text-on-primary mb-6 min-w-0 break-words">Your notes deserve files, not a walled garden.</h2>
						<p className="text-lg md:text-xl text-on-primary-fixed-variant mb-10 max-w-2xl mx-auto">Import your vault, collaborate in real time, and export everything whenever you want.</p>
						<Link
							href="/signup"
							className="relative inline-flex items-center justify-center whitespace-nowrap bg-surface text-primary-ink text-base md:text-lg px-6 py-4 md:px-10 md:py-5 rounded-xl font-bold active:scale-95 hover:shadow-md transition-[box-shadow,transform] w-full sm:w-auto focus-visible:outline focus-visible:ring-2 focus-visible:ring-surface"
						>
							Start Collaborating Now
						</Link>
						<p className="mt-6 text-sm text-on-primary-fixed-variant">
							Or claim a numbered founding spot:{' '}
							<Link href="/early?ref=cta" className="font-semibold underline underline-offset-4 hover:text-on-primary focus-visible:outline focus-visible:ring-2 focus-visible:ring-on-primary">
								500 spots, price locked for life
							</Link>
						</p>
					</div>
				</section>
			</div>
		</div>
	)
}
