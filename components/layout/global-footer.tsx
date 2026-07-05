'use client'

import React from 'react'

export function GlobalFooter() {
	return (
		<footer className="border-t border-border bg-background py-6 text-center text-xs text-muted-foreground mt-auto">
			<p>
				Developed by <span className="font-semibold text-foreground">Harsh Dave</span> |{' '}
				<a href="https://github.com/harshdave" className="text-primary hover:underline" target="_blank" rel="noreferrer">GitHub Profile</a> |{' '}
				<a href="https://linkedin.com/in/harshdave" className="text-primary hover:underline" target="_blank" rel="noreferrer">LinkedIn Profile</a>
			</p>
		</footer>
	)
}
