'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	useEffect(() => {
		console.error('Runtime Error:', error)
	}, [error])

	return (
		<div className="min-h-screen bg-background text-on-surface flex flex-col items-center justify-center p-4">
			<div className="max-w-md w-full bg-surface-container rounded-3xl p-8 border border-white/10 text-center shadow-xl">
				<div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto mb-6">
					<span className="material-symbols-outlined text-3xl">error</span>
				</div>
				<h2 className="text-2xl font-display-md font-bold mb-3 text-on-surface">Something went wrong</h2>
				<p className="text-on-surface-variant mb-8 text-sm">{error.message || 'An unexpected error occurred while loading this page.'}</p>
				<div className="flex gap-4 justify-center">
					<button
						onClick={reset}
						className="px-6 py-3 bg-primary text-on-primary rounded-xl font-bold hover:bg-primary/90 transition-colors"
					>
						Try again
					</button>
					<Link
						href="/"
						className="px-6 py-3 bg-surface-container-highest text-on-surface rounded-xl font-bold hover:bg-surface-variant transition-colors"
					>
						Go home
					</Link>
				</div>
			</div>
		</div>
	)
}
