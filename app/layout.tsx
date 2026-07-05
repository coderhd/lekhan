import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'

export const metadata: Metadata = {
	title: 'Lekhan - Collaborative Local-First Editor',
	description: 'A premium collaborative document editor featuring offline sync and AI capabilities',
	metadataBase: new URL('https://house-of-edtech-seven.vercel.app'),
	openGraph: {
		title: 'Lekhan - Collaborative Local-First Editor',
		description: 'A premium collaborative document editor featuring offline sync and AI capabilities',
		url: 'https://house-of-edtech-seven.vercel.app',
		siteName: 'Lekhan',
		images: [
			{
				url: '/landing-light.png',
				width: 1200,
				height: 630,
			},
		],
		locale: 'en_US',
		type: 'website',
	},
	twitter: {
		card: 'summary_large_image',
		title: 'Lekhan - Collaborative Local-First Editor',
		description: 'A premium collaborative document editor featuring offline sync and AI capabilities',
		images: ['/landing-light.png'],
	},
	icons: {
		icon: '/logo.png',
		apple: '/logo.png',
	},
}

export default function RootLayout ({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html lang='en' suppressHydrationWarning className="dark">
			<body className='min-h-screen bg-background text-on-surface antialiased selection:bg-primary/30 dark:selection:bg-primary dark:selection:text-on-primary'>
				<ThemeProvider
					attribute="class"
					defaultTheme="dark"
					enableSystem={false}
					disableTransitionOnChange
				>
					<main className="flex-1 flex flex-col">{children}</main>
					<Toaster />
				</ThemeProvider>
			</body>
		</html>
	)
}
