'use client'

import Link from 'next/link'
import { Lock } from 'lucide-react'

interface PublicAccessDeniedProps {
	/**
	 * `public` — signed-out visitor hitting a non-public or missing page;
	 *          primary action is logging in, secondary is creating a workspace.
	 * `internal` — signed-in user who can't reach the page; primary action is
	 *          returning home.
	 */
	variant: 'public' | 'internal'
}

/**
 * Inline access-denied screen for the `/page/[id]` route. Replaces the old
 * silent `router.push('/login')` bounce so a wrong or unshared link explains
 * itself instead of landing the visitor on the login form without context.
 */
export default function PublicAccessDenied ({ variant }: PublicAccessDeniedProps) {
	const isPublic = variant === 'public'

	return (
		<main className="min-h-screen bg-background text-on-background flex items-center justify-center px-4">
			<div className="w-full max-w-md text-center flex flex-col items-center">
				<div className="h-14 w-14 rounded-2xl bg-surface-container-low border border-black/10 dark:border-white/10 flex items-center justify-center mb-6">
					<Lock className="h-6 w-6 text-on-surface-variant" aria-hidden="true" />
				</div>
				<h1 className="text-lg font-bold text-on-surface mb-2">
					This page isn't available
				</h1>
				<p className="text-sm text-on-surface-variant mb-8 leading-relaxed">
					The link may be wrong, or the owner hasn't shared this page publicly.
				</p>
				{isPublic
					? (
						<div className="flex items-center gap-3">
							<Link
								href="/login"
								className="rounded-xl bg-primary-container text-on-primary-container font-bold py-2.5 px-5 text-sm hover:brightness-110 active:scale-95 transition-all shadow-sm"
							>
								Log in
							</Link>
							<Link
								href="/signup"
								className="rounded-xl border border-black/10 dark:border-white/10 py-2.5 px-5 text-sm font-semibold text-on-surface hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 premium-transition"
							>
								Create your workspace
							</Link>
						</div>
						)
					: (
						<Link
							href="/"
							className="rounded-xl bg-primary-container text-on-primary-container font-bold py-2.5 px-5 text-sm hover:brightness-110 active:scale-95 transition-all shadow-sm"
						>
							Back home
						</Link>
						)}
			</div>
		</main>
	)
}
