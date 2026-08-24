import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Lekhan — Founding Edition · 500 numbered spots',
	description:
		'Your second brain, your files, your AI. Local-first like Obsidian, collaborative like Notion — and AI runs on your own keys. Claim a numbered founding spot.',
	openGraph: {
		title: 'Lekhan — Founding Edition',
		description:
			'Local-first like Obsidian, collaborative like Notion — AI runs on your own keys. 500 numbered founding spots.',
		type: 'website',
	},
}

/**
 * Campaign-scoped type system (Hallmark 2+1 rule):
 * Fraunces display · Geist body · Geist Mono outlier (edition plate only).
 * Loaded here so the rest of the app is untouched.
 */
export default function EarlyLayout ({ children }: { children: React.ReactNode }) {
	return (
		<>
			<link rel="preconnect" href="https://fonts.googleapis.com" />
			<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
			<link
				href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Geist+Mono:wght@400;500&display=swap"
				rel="stylesheet"
			/>
			{children}
		</>
	)
}
