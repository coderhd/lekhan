'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { WorkspaceIllustration } from '@/components/workbench/workspace-illustration'

export default function Error({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	useEffect(() => {
		console.error('Page render failed:', error)
	}, [error])

	return (
		<section className="wb-empty" aria-labelledby="page-error-title">
			<WorkspaceIllustration variant="retry" />
			<h2 id="page-error-title">This page couldn’t open</h2>
			<p>Try opening the page again or return to your workspace.</p>
			<div className="wb-empty-actions">
				<button type="button" onClick={reset} className="wb-button wb-button-primary">
					Try again
				</button>
				<Link href="/" className="wb-button">Return to workspace</Link>
			</div>
		</section>
	)
}
