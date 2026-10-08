// Designed as — Lekhan public marketing · system: DESIGN.md (incumbent Material/Inter stack, cream/teak) · visual-consistency pass
import type { Metadata } from 'next'
import Link from 'next/link'
import { Zap, Lock, Users, Plane } from 'lucide-react'

export const metadata: Metadata = {
	title: 'About Lekhan — The Story Behind the Editor',
	description: 'Why we built a local-first collaborative editor: notes stay markdown files on your disk, multiplayer works offline, and AI runs on your own keys.',
	openGraph: {
			images: ['/og.png'],
		title: 'About Lekhan',
		description: 'The story behind the local-first collaborative editor built for focused teams.',
	},
}

const values = [
	{
		title: 'Speed Without Compromise',
		description: 'Every keystroke registers instantly. We chose local-first architecture because your thoughts should never wait for a network round-trip.',
		Icon: Zap,
	},
	{
		title: 'Privacy by Default',
		description: 'Your data lives on your device first. We don\'t scan your documents, sell your data, or train models on your writing. And AI runs on your own keys — bring a provider key or point it at a local model on your machine. Your words stay yours.',
		Icon: Lock,
	},
	{
		title: 'Collaboration Without Friction',
		description: 'Great teamwork shouldn\'t require great tooling expertise. Invite someone, start editing, and let the sync engine handle the rest.',
		Icon: Users,
	},
	{
		title: 'Offline is a Feature, Not a Failure',
		description: 'Wifi drops, planes take off, cafes lose signal. Lekhan keeps working. When you reconnect, everything merges automatically.',
		Icon: Plane,
	},
]

export default function AboutPage () {
	return (
		<div className="bg-background text-on-surface min-h-screen flex flex-col">
			<div className="max-w-[800px] mx-auto px-6 md:px-10 pt-8 pb-24 flex-1">
				{/* Header */}
				<div className="text-center mb-16">
					<h1 className="font-display-lg text-4xl md:text-5xl font-bold text-on-surface mb-4">
						About Lekhan
					</h1>
					<p className="text-lg text-on-surface-variant max-w-2xl mx-auto">
						Local-first like Obsidian, collaborative like Notion, AI on your own keys.
						Here&apos;s why we built it.
					</p>
				</div>

				{/* Origin Story */}
				<section className="mb-16">
					<h2 className="font-display-lg text-2xl md:text-3xl font-bold text-on-surface mb-6">
						The Problem
					</h2>
					<div className="space-y-4 text-on-surface-variant leading-relaxed">
						<p>
							Every collaborative editor makes the same trade-off: you get real-time sync, but you pay for it with latency, downtime anxiety, and someone else holding your data. Type a word, wait for the server, hope the connection holds. It works — until it doesn&apos;t.
						</p>
						<p>
							For teams that write together daily — whether it&apos;s documentation, notes, or creative work — that friction compounds. Slow editors kill flow. Offline gaps lose ideas. And the constant background worry of &ldquo;is my work saved?&rdquo; shouldn&apos;t exist at all.
						</p>
						<p>
							Lekhan was built to fix this. The name comes from the Hindi word <span className="text-on-surface font-medium">लेखन</span>, meaning &ldquo;writing.&rdquo; It&apos;s a local-first editor that puts your device at the center — your edits save instantly, sync happens in the background, and collaboration works even when the internet doesn&apos;t.
						</p>
					</div>
				</section>

				{/* Mission */}
				<section className="mb-16">
					<div className="glass rounded-2xl p-8 md:p-10 border border-primary-container/20">
						<h2 className="font-display-lg text-xl md:text-2xl font-bold text-on-surface mb-3">
							Our Mission
						</h2>
						<p className="text-lg text-on-surface-variant leading-relaxed">
							We build writing tools that respect your time, your privacy, and your workflow — so teams can focus on what they&apos;re writing, not the tool they&apos;re writing with.
						</p>
					</div>
				</section>

				{/* Creator */}
				<section className="mb-16">
					<h2 className="font-display-lg text-2xl md:text-3xl font-bold text-on-surface mb-6">
						Built by
					</h2>
					<div className="flex flex-col sm:flex-row items-start gap-6">
						<div className="w-20 h-20 rounded-2xl bg-primary-container/10 border border-primary-container/20 flex items-center justify-center text-3xl font-bold text-primary-container shrink-0">
							HD
						</div>
						<div>
							<h3 className="font-headline-md text-xl font-bold text-on-surface mb-1">
								Harsh Dave
							</h3>
							<p className="text-sm text-primary mb-3">Creator & Developer</p>
							<p className="text-on-surface-variant leading-relaxed mb-4">
								Full-stack developer building tools that stay out of your way. Harsh designed Lekhan to be the editor he always wanted — fast, private, and collaborative from the first keystroke.
							</p>
							<div className="flex items-center gap-4">
								<a
									href="https://github.com/coderhd"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
								>
									GitHub
								</a>
								<a
									href="https://linkedin.com/in/harshdave95"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
								>
									LinkedIn
								</a>
								<a
									href="https://x.com/harshdave1094"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
								>
									X (Twitter)
								</a>
							</div>
						</div>
					</div>
				</section>

				{/* Values */}
				<section className="mb-16">
					<h2 className="font-display-lg text-2xl md:text-3xl font-bold text-on-surface mb-8">
						What We Believe
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{values.map((value) => (
							<div key={value.title} className="glass rounded-xl p-6">
								<div className="text-primary-ink mb-3">
									<value.Icon className="w-6 h-6" />
								</div>
								<h3 className="font-headline-md text-lg font-bold text-on-surface mb-2">
									{value.title}
								</h3>
								<p className="text-sm text-on-surface-variant leading-relaxed">
									{value.description}
								</p>
							</div>
						))}
					</div>
				</section>

				{/* CTA */}
				<div className="text-center pt-12 border-t border-border">
					<h2 className="font-display-lg text-2xl md:text-3xl font-bold text-on-surface mb-4">
						Try it yourself
					</h2>
					<p className="text-on-surface-variant mb-8">
						The best way to understand Lekhan is to use it.
					</p>
					<Link
						href="/signup"
						className="inline-block bg-primary-container text-on-primary text-base px-8 py-4 rounded-xl font-bold active:scale-[0.98] hover:bg-primary transition-colors whitespace-nowrap"
					>
						Start Writing Free
					</Link>
					<p className="text-xs text-on-surface-variant mt-3">No credit card required</p>
				</div>
			</div>
		</div>
	)
}
