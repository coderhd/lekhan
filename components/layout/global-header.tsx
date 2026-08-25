'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isEditorPathname } from '@/lib/routes'
import ThemeToggle from '../theme-toggle'
import { supabase } from '@/lib/supabase'
import { useGlobalHeaderSlots } from './global-header-context'

interface GlobalHeaderProps {
	children?: React.ReactNode // For center/left items
	rightActions?: React.ReactNode // For right-side overrides (like profile menu, custom buttons)
}

export function GlobalHeader({ children, rightActions }: GlobalHeaderProps) {
	const pathname = usePathname()
	const { slots } = useGlobalHeaderSlots()
	const [user, setUser] = useState<any | null>(null)
	const [loading, setLoading] = useState(true)
	const [menuOpen, setMenuOpen] = useState(false)
	const [isVisible, setIsVisible] = useState(true)
	const lastScrollY = useRef(0)
	const frame = useRef<number | null>(null)

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

	useEffect(() => {
		lastScrollY.current = window.scrollY

		const handleScroll = () => {
			if (frame.current !== null) return
			frame.current = 1
			window.requestAnimationFrame(() => {
				const currentY = Math.max(window.scrollY, 0)
				const delta = currentY - lastScrollY.current
				if (currentY <= 16 || delta < 0) setIsVisible(true)
				else if (delta > 0) setIsVisible(false)
				lastScrollY.current = currentY
				frame.current = null
			})
		}

		window.addEventListener('scroll', handleScroll, { passive: true })
		return () => {
			window.removeEventListener('scroll', handleScroll)
			if (frame.current !== null) window.cancelAnimationFrame(frame.current)
		}
	}, [])

	if (
		pathname === '/login' ||
		pathname === '/signup' ||
		pathname === '/forgot-password' ||
		isEditorPathname(pathname)
	) {
		return null
	}

	const mainContent = slots.main?.content ?? children
	const rightContent = slots.right?.content ?? rightActions

	return (
		<header
			className={`sticky top-0 z-50 flex min-h-[4rem] items-center justify-between border-b border-border/40 bg-background/80 px-6 py-3 backdrop-blur-md transition-[transform,opacity] duration-300 motion-reduce:transition-none ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'}`}
			data-header-visible={isVisible}
		>
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
				{/* Desktop nav — slot content renders twice (desktop row + mobile panel) */}
				{mainContent && <div className="hidden md:flex items-center gap-6">{mainContent}</div>}
			</div>

			<div className="flex items-center gap-4">
				{mainContent && (
					<button
						type="button"
						aria-expanded={menuOpen}
						aria-controls="mobile-nav"
						aria-label={menuOpen ? 'Close menu' : 'Open menu'}
						onClick={() => setMenuOpen(v => !v)}
						className="md:hidden flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-on-surface hover:bg-surface transition-colors text-lg"
					>
						{menuOpen ? '✕' : '☰'}
					</button>
				)}
				{rightContent ? (
					rightContent
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

			{menuOpen && mainContent && (
				<nav
					id="mobile-nav"
					aria-label="Main"
					onClick={() => setMenuOpen(false)}
					className="absolute top-full left-0 right-0 border-b border-border/40 bg-background/95 backdrop-blur-md px-6 py-4 flex flex-col md:hidden"
				>
					{mainContent}
				</nav>
			)}
		</header>
	)
}
