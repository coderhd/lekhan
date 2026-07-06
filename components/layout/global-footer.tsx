'use client'

import React from 'react'
import { usePathname } from 'next/navigation'

export function GlobalFooter() {
	const pathname = usePathname()

	// Do not display global footer in Editor page
	if (pathname?.startsWith('/doc/')) {
		return null
	}

	return (
		<footer className="border-t border-border bg-background py-6 text-center text-xs text-muted-foreground mt-auto">
			<p>
				Developed by <span className="font-semibold text-foreground">Harsh Dave</span> |{' '}
				<a href="https://github.com/coderhd" className="text-primary hover:underline" target="_blank" rel="noreferrer">GitHub</a> |{' '}
				<a href="https://linkedin.com/in/harshdave95" className="text-primary hover:underline" target="_blank" rel="noreferrer">LinkedIn</a>
			</p>
		</footer>
	)
}
