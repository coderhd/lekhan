import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import Footer from '@/components/footer'

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
			<head>
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
				<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Montserrat:wght@600;700&family=Geist:wght@400;500;600&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
			</head>
			<body className='min-h-screen bg-background text-on-surface antialiased selection:bg-primary/30 dark:selection:bg-primary dark:selection:text-on-primary'>
				<ThemeProvider
					attribute="class"
					defaultTheme="dark"
					enableSystem={false}
					disableTransitionOnChange
				>
					<div className="flex flex-col min-h-screen">
						<main className="flex-1 flex flex-col">{children}</main>
						<Footer />
					</div>
					<Toaster />
				</ThemeProvider>
			</body>
		</html>
	)
}
