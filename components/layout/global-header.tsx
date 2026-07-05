'use client'

import React from 'react'
import Link from 'next/link'
import { ThemeToggle } from '../theme-toggle'

interface GlobalHeaderProps {
	children?: React.ReactNode // For injecting context-specific UI like search bars or sync indicators
}

export function GlobalHeader({ children }: GlobalHeaderProps) {
	return (
		<header className="sticky top-0 z-50 flex min-h-[4rem] items-center justify-between border-b border-border bg-background/80 px-6 py-3 backdrop-blur-md">
			<div className="flex items-center gap-4 flex-1">
				<Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
					<img src="/logo.png" alt="Lekhan Logo" className="h-8 w-8 rounded-lg shadow-sm border border-border hidden sm:block" />
					<span className="text-xl font-bold tracking-tight text-primary">
						Lekhan Workspace
					</span>
				</Link>
				{children}
			</div>
			<div className="flex items-center gap-4">
				<ThemeToggle />
			</div>
		</header>
	)
}
