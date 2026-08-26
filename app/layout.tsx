import type { Metadata } from 'next'
import { GoogleAnalytics } from '@/components/analytics/google-analytics'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { GlobalFooter } from '@/components/layout/global-footer'
import { GlobalHeader } from '@/components/layout/global-header'
import { GlobalHeaderProvider } from '@/components/layout/global-header-context'

export const metadata: Metadata = {
	title: {
		default: 'Lekhan — Your notes, on your disk. Now multiplayer',
		template: '%s | Lekhan',
	},
	description: 'Write, edit, and collaborate in real-time with Lekhan. A local-first editor with zero typing latency, full offline support, and AI assistance. Start writing free.',
	metadataBase: new URL('https://lekhan.online'),
	openGraph: {
		title: 'Lekhan — Write Together, Without Limits',
		description: 'A local-first collaborative editor with zero typing latency, offline support, and AI-assisted writing. Built for teams that value speed and privacy.',
		url: 'https://lekhan.online',
		siteName: 'Lekhan',
		images: [
			{
				url: '/og.png',
				width: 1200,
				height: 630,
			},
		],
		locale: 'en_US',
		type: 'website',
	},
	twitter: {
		card: 'summary_large_image',
		title: 'Lekhan — Write Together, Without Limits',
		description: 'Local-first collaborative editor. Zero latency, full offline, AI-powered. Start writing free.',
		images: ['/og.png'],
	},
	icons: {
		icon: '/logo.png',
		apple: '/logo.png',
	},
}

import { SessionReauthProvider } from '@/components/session-reauth-provider'
import { SessionInfoBanner } from '@/components/session-info-banner'
import GlobalSearchPalette from '@/components/global-search-palette'
import { AnalyticsProvider } from '@/components/analytics/analytics-provider'

export default function RootLayout({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html lang='en' suppressHydrationWarning className="dark">
			<head>
				<GoogleAnalytics />
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
				<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Montserrat:wght@600;700&family=Geist:wght@400;500;600&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
			</head>
			<body className='min-h-screen bg-background text-on-surface antialiased selection:bg-primary/30 dark:selection:bg-primary dark:selection:text-on-primary'>
				<a href='#main-content' className='sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-primary focus:text-on-primary focus:px-4 focus:py-2 focus:rounded-lg'>Skip to content</a>
				<ThemeProvider
					attribute="class"
					defaultTheme="dark"
					enableSystem={false}
					disableTransitionOnChange
				>
					<AnalyticsProvider>
						<SessionReauthProvider>
							<GlobalSearchPalette>
								<GlobalHeaderProvider>
									<GlobalHeader />
									<div id="main-content" className="flex min-h-screen flex-col">
										<main className="flex flex-1 flex-col">{children}</main>
										<GlobalFooter />
									</div>
									<SessionInfoBanner />
									<Toaster />
								</GlobalHeaderProvider>
							</GlobalSearchPalette>
						</SessionReauthProvider>
					</AnalyticsProvider>
				</ThemeProvider>
			</body>
		</html>
	)
}
