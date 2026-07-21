import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
	title: 'Frequently Asked Questions | Lekhan',
	description: 'Find answers about Lekhan — the local-first collaborative editor. Learn about offline support, real-time collaboration, AI features, security, and more.',
	openGraph: {
		title: 'FAQ — Lekhan',
		description: 'Everything you need to know about Lekhan, the collaborative local-first writing tool.',
	},
}

interface FaqItem {
	question: string
	answer: string
}

interface FaqGroup {
	title: string
	items: FaqItem[]
}

const faqData: FaqGroup[] = [
	{
		title: 'Getting Started',
		items: [
			{
				question: 'Is Lekhan free to use?',
				answer: 'Yes. Lekhan is completely free to use. Sign up and start writing immediately — no credit card required, no trial period.',
			},
			{
				question: 'Do I need to install anything?',
				answer: 'No. Lekhan runs entirely in your browser. Just sign up, create a document, and start writing. It works on any modern desktop or laptop browser.',
			},
			{
				question: 'How do I create my first document?',
				answer: 'After signing in, click the "New Document" button on your dashboard. You can start typing immediately — your work is saved locally the instant you type.',
			},
		],
	},
	{
		title: 'Features',
		items: [
			{
				question: 'What does "local-first" mean?',
				answer: 'Local-first means your edits are saved directly to your device before syncing to the cloud. This gives you zero typing latency and means the editor works even without an internet connection.',
			},
			{
				question: 'How does real-time collaboration work?',
				answer: 'Share your document with teammates and edit simultaneously. Changes from all collaborators appear instantly with automatic conflict resolution — no more merging issues or "which version is latest?" problems.',
			},
			{
				question: 'What AI features does Lekhan include?',
				answer: 'Lekhan includes an AI assistant panel that helps with writing tasks like summarizing content, improving clarity, fixing grammar, and generating ideas — all accessible directly inside your document.',
			},
			{
				question: 'Can I see the history of my document?',
				answer: 'Yes. Lekhan includes full version history so you can see exactly how your document evolved over time and restore any previous version safely.',
			},
		],
	},
	{
		title: 'Security & Privacy',
		items: [
			{
				question: 'Is my data secure?',
				answer: 'Absolutely. Your data is encrypted in transit, and Lekhan uses Supabase with row-level security policies to ensure only authorized users can access your documents.',
			},
			{
				question: 'Who can see my documents?',
				answer: 'Only you and the people you explicitly share with. Lekhan uses role-based access control (Owner, Editor, Viewer) so you always control who can read and edit your work.',
			},
			{
				question: 'Where is my data stored?',
				answer: 'Your data lives locally on your device first, then syncs to secure cloud storage powered by Supabase. You always maintain full ownership of your content.',
			},
		],
	},
	{
		title: 'Collaboration',
		items: [
			{
				question: 'How do I invite someone to edit a document?',
				answer: 'Open your document, click the "Share" button, and enter your collaborator\'s email. They\'ll receive an invite link and can join instantly.',
			},
			{
				question: 'What happens if two people edit the same section?',
				answer: 'Lekhan handles this automatically. The sync engine resolves conflicts deterministically so both sets of changes are preserved — no work is ever lost.',
			},
			{
				question: 'Can I make a document read-only for some people?',
				answer: 'Yes. When sharing, you can assign the "Viewer" role. Viewers can see the document in real-time but cannot make edits.',
			},
			{
				question: 'What happens if I go offline while collaborating?',
				answer: 'You can keep writing normally. When you reconnect, Lekhan automatically merges your changes with everyone else\'s — seamlessly and without data loss.',
			},
		],
	},
]

function FaqAccordion ({ group }: { group: FaqGroup }) {
	return (
		<div className="mb-12">
			<h2 className="font-display-lg text-2xl md:text-3xl font-bold text-on-surface mb-6">
				{group.title}
			</h2>
			<div className="space-y-3">
				{group.items.map((item, index) => (
					<details
						key={index}
						className="group glass rounded-xl overflow-hidden"
					>
						<summary className="flex items-center justify-between cursor-pointer px-6 py-5 text-on-surface font-medium text-base select-none list-none">
							<span>{item.question}</span>
							<svg
								className="w-5 h-5 text-muted-foreground transition-transform duration-200 group-open:rotate-180 shrink-0 ml-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={2}
							>
								<path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
							</svg>
						</summary>
						<div className="px-6 pb-5 text-muted-foreground text-sm leading-relaxed">
							{item.answer}
						</div>
					</details>
				))}
			</div>
		</div>
	)
}

export default function FaqPage () {
	return (
		<div className="bg-background text-on-surface min-h-screen flex flex-col">
			<div className="max-w-[800px] mx-auto px-6 md:px-10 pt-8 pb-24 flex-1">
				{/* Header */}
				<div className="text-center mb-16">
					<h1 className="font-display-lg text-4xl md:text-5xl font-bold text-on-surface mb-4">
						Frequently Asked Questions
					</h1>
					<p className="text-lg text-muted-foreground max-w-2xl mx-auto">
						Everything you need to know about Lekhan. Can&apos;t find what you&apos;re looking for? <Link href="/contact" className="text-primary hover:underline">Reach out directly</Link>.
					</p>
				</div>

				{/* FAQ Groups */}
				{faqData.map((group) => (
					<FaqAccordion key={group.title} group={group} />
				))}

				{/* Bottom CTA */}
				<div className="text-center mt-16 pt-12 border-t border-border">
					<h2 className="font-display-lg text-2xl md:text-3xl font-bold text-on-surface mb-4">
						Ready to start writing?
					</h2>
					<p className="text-muted-foreground mb-8">
						Join teams who&apos;ve already upgraded their writing workflow.
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
