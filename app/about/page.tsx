import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
	title: 'About Lekhan — The Story Behind the Editor',
	description: 'Learn why Lekhan was built, the problems it solves, and the person behind the project. A local-first editor designed for teams who value speed, privacy, and focus.',
	openGraph: {
		title: 'About Lekhan',
		description: 'The story behind the local-first collaborative editor built for focused teams.',
	},
}

const values = [
	{
		title: 'Speed Without Compromise',
		description: 'Every keystroke registers instantly. We chose local-first architecture because your thoughts should never wait for a network round-trip.',
		icon: '⚡',
	},
	{
		title: 'Privacy by Default',
		description: 'Your data lives on your device first. We don\'t scan your documents, sell your data, or train models on your writing. Your words stay yours.',
		icon: '🔒',
	},
	{
		title: 'Collaboration Without Friction',
		description: 'Great teamwork shouldn\'t require great tooling expertise. Invite someone, start editing, and let the sync engine handle the rest.',
		icon: '🤝',
	},
	{
		title: 'Offline is a Feature, Not a Failure',
		description: 'Wifi drops, planes take off, cafes lose signal. Lekhan keeps working. When you reconnect, everything merges seamlessly.',
		icon: '✈️',
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
					<p className="text-lg text-muted-foreground max-w-2xl mx-auto">
						A writing tool built because the existing ones kept getting in the way.
					</p>
				</div>

				{/* Origin Story */}
				<section className="mb-16">
					<h2 className="font-display-lg text-2xl md:text-3xl font-bold text-on-surface mb-6">
						The Problem
					</h2>
					<div className="space-y-4 text-muted-foreground leading-relaxed">
						<p>
							Every collaborative editor makes the same trade-off: you get real-time sync, but you pay for it with latency, downtime anxiety, and someone else holding your data. Type a word, wait for the server, hope the connection holds. It works — until it doesn&apos;t.
						</p>
						<p>
							For teams that write together daily — whether it&apos;s documentation, notes, or creative work — that friction compounds. Slow editors kill flow. Offline gaps lose ideas. And the constant background worry of &ldquo;is my work saved?&rdquo; shouldn&apos;t exist in 2025.
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
						<p className="text-lg text-muted-foreground leading-relaxed">
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
							<p className="text-muted-foreground leading-relaxed mb-4">
								Full-stack developer passionate about building tools that stay out of your way. Harsh designed Lekhan to be the editor he always wanted — fast, private, and effortlessly collaborative.
							</p>
							<div className="flex items-center gap-4">
								<a
									href="https://github.com/coderhd"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-muted-foreground hover:text-foreground transition-colors"
								>
									GitHub
								</a>
								<a
									href="https://linkedin.com/in/harshdave95"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-muted-foreground hover:text-foreground transition-colors"
								>
									LinkedIn
								</a>
								<a
									href="https://x.com/harshdave1094"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-muted-foreground hover:text-foreground transition-colors"
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
								<div className="text-2xl mb-3">{value.icon}</div>
								<h3 className="font-headline-md text-lg font-bold text-on-surface mb-2">
									{value.title}
								</h3>
								<p className="text-sm text-muted-foreground leading-relaxed">
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
					<p className="text-muted-foreground mb-8">
						The best way to understand Lekhan is to use it.
					</p>
					<Link
						href="/signup"
						className="inline-block bg-primary-container text-on-primary text-base px-8 py-4 rounded-xl font-bold active:scale-[0.98] hover:shadow-lg hover:shadow-primary-container/20 transition-all"
					>
						Start Writing Free
					</Link>
					<p className="text-xs text-muted-foreground mt-3">No credit card required</p>
				</div>
			</div>
		</div>
	)
}
