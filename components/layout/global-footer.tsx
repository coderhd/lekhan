'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isEditorPathname } from '@/lib/routes'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const footerLinks = {
	product: [
		{ label: 'Features', href: '/#features' },
		{ label: 'FAQ', href: '/faq' },
	],
	company: [
		{ label: 'About', href: '/about' },
		{ label: 'Contact', href: '/contact' },
	],
	legal: [
		{ label: 'Privacy Policy', href: '/privacy-policy' },
		{ label: 'Terms of Service', href: '/terms-of-service' },
	],
}

const socialLinks = [
	{
		label: 'X (Twitter)',
		href: 'https://x.com/harshdave1094',
		icon: (
			<svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
				<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.004 3.985H5.078z" />
			</svg>
		),
	},
	{
		label: 'LinkedIn',
		href: 'https://linkedin.com/in/harshdave95',
		icon: (
			<svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
				<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
			</svg>
		),
	},
	{
		label: 'GitHub',
		href: 'https://github.com/coderhd/lekhan',
		icon: (
			<svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
				<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
			</svg>
		),
	},
	{
		label: 'Email',
		href: 'mailto:harshdave1094@gmail.com',
		icon: (
			<svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<rect width="20" height="16" x="2" y="4" rx="2" />
				<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
			</svg>
		),
	},
]

export function GlobalFooter() {
	const pathname = usePathname()
	const [isAuthenticated, setIsAuthenticated] = useState(false)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const checkAuth = async () => {
			try {
				const { data: { session } } = await supabase.auth.getSession()
				setIsAuthenticated(!!session)
			} catch (err) {
				console.error('Session check error in GlobalFooter:', err)
			} finally {
				setLoading(false)
			}
		}

		checkAuth()

		const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
			setIsAuthenticated(!!session)
		})

		return () => {
			subscription.unsubscribe()
		}
	}, [])

	// Hide footer completely on editor page (edge-to-edge editor chrome)
	if (isEditorPathname(pathname)) {
		return null
	}

	const isAuthPage = pathname === '/settings' || (pathname === '/' && isAuthenticated)
	const hideTopSection = !loading && isAuthPage

	return (
		<footer className="border-t border-border/40 bg-background mt-auto transition-colors duration-300">
			{/* Navigation Grid */}
			{!hideTopSection && (
				<div className="max-w-[1200px] mx-auto px-6 md:px-10 pt-12 pb-10">
					<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
						{/* Brand Column */}
						<div className="flex flex-col gap-4 pr-4">
							<Link href="/" className="flex items-center gap-2.5 group w-fit">
								<img
									alt="Lekhan Logo"
									className="h-6 w-6 object-contain cursor-pointer group-hover:scale-110 premium-transition"
									src="/logo.png"
								/>
								<span className="font-display-lg text-lg md:text-xl font-bold text-primary group-hover:text-primary/80 transition-colors tracking-tight">
									Lekhan
								</span>
							</Link>
							<p className="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
								Write together, without limits. Premium local-first collaborative editor.
							</p>
						</div>

						{/* Product */}
						<div>
							<h3 className="font-semibold text-xs text-foreground uppercase tracking-wider mb-4">Product</h3>
							<ul className="space-y-3">
								{footerLinks.product.map((link) => (
									<li key={link.href}>
										<Link
											href={link.href}
											className="text-xs text-muted-foreground hover:text-primary transition-colors duration-200"
										>
											{link.label}
										</Link>
									</li>
								))}
							</ul>
						</div>

						{/* Company */}
						<div>
							<h3 className="font-semibold text-xs text-foreground uppercase tracking-wider mb-4">Company</h3>
							<ul className="space-y-3">
								{footerLinks.company.map((link) => (
									<li key={link.href}>
										<Link
											href={link.href}
											className="text-xs text-muted-foreground hover:text-primary transition-colors duration-200"
										>
											{link.label}
										</Link>
									</li>
								))}
							</ul>
						</div>

						{/* Legal */}
						<div>
							<h3 className="font-semibold text-xs text-foreground uppercase tracking-wider mb-4">Legal</h3>
							<ul className="space-y-3">
								{footerLinks.legal.map((link) => (
									<li key={link.href}>
										<Link
											href={link.href}
											className="text-xs text-muted-foreground hover:text-primary transition-colors duration-200"
										>
											{link.label}
										</Link>
									</li>
								))}
							</ul>
						</div>
					</div>
				</div>
			)}

			{/* Bottom Bar */}
			<div className="border-t border-border/40">
				<div className="max-w-[1200px] mx-auto px-6 md:px-10 py-5 flex flex-col md:flex-row items-center justify-between gap-4">
					{/* Copyright */}
					<p className="text-xs text-muted-foreground order-2 md:order-1">
						&copy; {new Date().getFullYear()} Lekhan. All rights reserved.
					</p>

					{/* Built with love */}
					<p className="text-xs text-muted-foreground order-1 md:order-2">
						Built with <span className="text-primary">&hearts;</span> by{' '}
						<span className="font-semibold hover:font-bold transition-all text-foreground">
							<a href="https://coderhd.github.io" target="_blank" rel="noreferrer">Harsh Dave</a>
						</span>
					</p>

					{/* Social Icons */}
					<div className="flex items-center gap-4 order-3">
						{socialLinks.map((social) => (
							<a
								key={social.label}
								href={social.href}
								target="_blank"
								rel="noopener noreferrer"
								className="text-foreground hover:text-primary transition-colors"
								aria-label={social.label}
							>
								{social.icon}
							</a>
						))}
					</div>
				</div>
			</div>
		</footer>
	)
}
