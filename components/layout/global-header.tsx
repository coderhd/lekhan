'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import ThemeToggle from '../theme-toggle'
import { supabase } from '@/lib/supabase'

interface GlobalHeaderProps {
	children?: React.ReactNode // For center/left items
	rightActions?: React.ReactNode // For right-side overrides (like profile menu, custom buttons)
}

export function GlobalHeader({ children, rightActions }: GlobalHeaderProps) {
	const [user, setUser] = useState<any | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const checkSession = async () => {
			try {
				const { data: { session } } = await supabase.auth.getSession()
				setUser(session?.user ?? null)
			} catch (err) {
				console.error('Session check error in GlobalHeader:', err)
			} finally {
				setLoading(false)
			}
		}

		checkSession()

		const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
			setUser(session?.user ?? null)
		})

		return () => {
			subscription.unsubscribe()
		}
	}, [])

	return (
		<header className="sticky top-0 z-50 flex min-h-[4rem] items-center justify-between border-b border-border/40 bg-background/80 px-6 py-3 backdrop-blur-md transition-colors duration-300">
			<div className="flex items-center gap-4 flex-1">
				{/* <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
					<img 
						src="/logo.png" 
						alt="Lekhan Logo" 
						className="h-8 w-8 rounded-lg shadow-sm border border-border/40 object-contain" 
					/>
					<span className="text-xl font-bold tracking-tight text-primary">
						Lekhan
					</span>
				</Link> */}
				<Link href="/" className="flex items-center group cursor w-fit">
					<img alt="Lekhan Logo" className="h-6 w-6 md:h-7 md:w-7 object-contain cursor-pointer hover:scale-110 transition-transform" src="/logo.png" />
					<span className="font-display-lg text-xl md:text-2xl font-bold text-primary-container transition-colors group-hover:text-primary leading-none translate-y-[1px]">ekhan</span>
				</Link>
				{children}
			</div>

			<div className="flex items-center gap-4">
				{rightActions ? (
					rightActions
				) : (
					<>
						<ThemeToggle />
						{!loading && (
							user ? (
								<Link
									href="/"
									className="text-xs bg-primary-container text-on-primary-fixed font-bold px-4 py-2 rounded-lg hover:bg-primary transition-colors active:scale-95 shadow-sm"
								>
									Dashboard
								</Link>
							) : (
								<Link
									href="/login"
									className="text-xs bg-primary-container text-on-primary-fixed font-bold px-4 py-2 rounded-lg hover:bg-primary transition-colors active:scale-95 shadow-sm"
								>
									Log In
								</Link>
							)
						)}
					</>
				)}
			</div>
		</header>
	)
}
