import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
	title: 'Contact — Get in Touch | Lekhan',
	description: 'Have questions or feedback about Lekhan? Reach out via email or connect on social media. We\'d love to hear from you.',
	openGraph: {
		title: 'Contact Lekhan',
		description: 'Reach out with questions, feedback, or just to say hello.',
	},
}

const contactChannels = [
	{
		title: 'Email',
		description: 'For questions, feedback, or support',
		value: 'harshdave1094@gmail.com',
		href: 'mailto:harshdave1094@gmail.com',
		icon: (
			<svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
				<rect width="20" height="16" x="2" y="4" rx="2" />
				<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
			</svg>
		),
	},
	{
		title: 'GitHub',
		description: 'Report bugs or contribute to the project',
		value: 'github.com/coderhd',
		href: 'https://github.com/coderhd',
		icon: (
			<svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
				<path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
			</svg>
		),
	},
	{
		title: 'LinkedIn',
		description: 'Connect professionally',
		value: 'linkedin.com/in/harshdave95',
		href: 'https://linkedin.com/in/harshdave95',
		icon: (
			<svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
				<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
			</svg>
		),
	},
	{
		title: 'X (Twitter)',
		description: 'Follow for updates and announcements',
		value: '@harshdave1094',
		href: 'https://x.com/harshdave1094',
		icon: (
			<svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
				<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.004 3.985H5.078z" />
			</svg>
		),
	},
]

export default function ContactPage () {
	return (
		<div className="bg-background text-on-surface min-h-screen flex flex-col">
			<div className="max-w-[800px] mx-auto px-6 md:px-10 pt-8 pb-24 flex-1">
				{/* Header */}
				<div className="text-center mb-16">
					<h1 className="font-display-lg text-4xl md:text-5xl font-bold text-on-surface mb-4">
						Get in Touch
					</h1>
					<p className="text-lg text-muted-foreground max-w-2xl mx-auto">
						Have a question, found a bug, or just want to share feedback? We&apos;d love to hear from you.
					</p>
				</div>

				{/* Contact Channels */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
					{contactChannels.map((channel) => (
						<a
							key={channel.title}
							href={channel.href}
							target="_blank"
							rel="noopener noreferrer"
							className="glass rounded-xl p-6 flex items-start gap-4 transition-all hover:-translate-y-1 hover:border-primary-container/40 group"
						>
							<div className="w-12 h-12 rounded-xl bg-primary-container/10 flex items-center justify-center text-primary-container shrink-0 group-hover:bg-primary-container/20 transition-colors">
								{channel.icon}
							</div>
							<div>
								<h2 className="font-headline-md text-lg font-bold text-on-surface mb-1">
									{channel.title}
								</h2>
								<p className="text-sm text-muted-foreground mb-2">
									{channel.description}
								</p>
								<span className="text-sm text-primary-ink font-medium">
									{channel.value}
								</span>
							</div>
						</a>
					))}
				</div>

				{/* Response Time Notice */}
				<div className="glass rounded-2xl p-8 md:p-10 text-center border border-primary-container/20">
					<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
						Open Source & Community Driven
					</h2>
					<p className="text-muted-foreground leading-relaxed max-w-lg mx-auto">
						Lekhan is an open-source project. The best way to report bugs or request features is through our <a href="https://github.com/coderhd" target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">GitHub repository</a>. For everything else, email works great.
					</p>
				</div>

				{/* CTA */}
				<div className="text-center mt-16 pt-12 border-t border-border">
					<p className="text-muted-foreground mb-6">
						Not sure if Lekhan is right for you?
					</p>
					<Link
						href="/faq"
						className="text-primary-ink font-semibold hover:underline"
					>
						Check out our FAQ →
					</Link>
				</div>
			</div>
		</div>
	)
}
