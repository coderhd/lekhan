// Designed as — Lekhan public marketing · system: DESIGN.md (incumbent Material/Inter stack, cream/teak) · visual-consistency pass
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
	title: 'Frequently Asked Questions | Lekhan',
	description: 'How Lekhan stores your notes, how offline multiplayer works, and why AI here runs on your own keys instead of another subscription.',
	openGraph: {
			images: ['/og.png'],
		title: 'FAQ — Lekhan',
		description: 'How Lekhan stores your notes, how offline multiplayer works, and why AI here runs on your own keys.',
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
				answer: 'Yes. Lekhan is free to use while we\'re in build — sign up and start writing, no credit card required. Founding-edition spots lock the price for life when paid plans arrive.',
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
				answer: 'Local-first means your edits are saved directly to your device before syncing to the cloud. There is no network round-trip between your keystroke and the save, so the editor works even without an internet connection.',
			},
			{
				question: 'How does real-time collaboration work?',
				answer: 'Share your document with teammates and edit simultaneously. Changes from all collaborators appear instantly with automatic conflict resolution — no more merging issues or "which version is latest?" problems.',
			},
			{
				question: 'What AI features does Lekhan include?',
				answer: 'An AI assistant panel inside every document: summarize, improve clarity, fix grammar, generate ideas. Bring your own API key (OpenAI, Anthropic, Gemini, Sarvam, or a custom endpoint) — cloud calls are relayed through our API to the provider you pick. Or run a local model like Ollama, and requests go straight from your browser. On your own key, AI never consumes plan credits.',
			},
			{
				question: 'Can I move in from Obsidian?',
				answer: 'Yes. Import your vault and your wikilinks, callouts, frontmatter, and tags come with you. The import produces a fidelity report that names anything it couldn\'t map — you always know exactly what arrived.',
			},
			{
				question: 'Can I see the history of my document?',
				answer: 'Yes — git-style history that lives on your own disk. Pin any version and it stays forever; auto-snapshots roll inside a generous local budget (100 MB per document). Visual diffs let you time-travel and restore, and local history is never gated by plan.',
			},
		],
	},
	{
		title: 'Security & Privacy',
		items: [
			{
				question: 'Is my data secure?',
				answer: 'Your notes are encrypted in transit and at rest by default. Cloud sync runs on Supabase with row-level security, so only you and the accounts you explicitly share a document with can access it.',
			},
			{
				question: 'Who can see my documents?',
				answer: 'Only you and the people you explicitly share with — unless you switch on the public link, which anyone holding it can read without signing in. Role-based access control (Owner, Editor, Viewer) governs who can edit your work.',
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
				answer: 'Open your document, click the "Share" button, and enter your collaborator\'s email. They\'ll receive an invite link — once they sign in, they\'re in the document with you.',
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
				answer: 'You can keep writing normally. When you reconnect, Lekhan automatically merges your changes with everyone else\'s — no data loss.',
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
								className="w-5 h-5 text-on-surface-variant transition-transform duration-200 group-open:rotate-180 shrink-0 ml-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={2}
							>
								<path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
							</svg>
						</summary>
						<div className="px-6 pb-5 text-on-surface-variant text-sm leading-relaxed">
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
					<p className="text-lg text-on-surface-variant max-w-2xl mx-auto">
						How your notes are stored, how sync works, and why AI here doesn&apos;t mean
						another subscription. Can&apos;t find what you&apos;re looking for? <Link href="/contact" className="text-primary-ink hover:underline">Reach out directly</Link>.
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
					<p className="text-on-surface-variant mb-8">
						Free to use while we're in build. Your notes go in and out as markdown, so you're never locked in.
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
