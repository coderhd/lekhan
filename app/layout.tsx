import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
	title: 'Local-First Collaborative Editor',
	description: 'A premium collaborative document editor featuring offline sync and AI capabilities',
}

export default function RootLayout ({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html lang='en'>
			<body className='min-h-screen bg-background text-foreground antialiased'>
				{children}
			</body>
		</html>
	)
}
