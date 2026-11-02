'use client'

import Link from 'next/link'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2'

export type WorkspaceView = 'pages' | 'graph'

const VIEWS: ReadonlyArray<{ id: WorkspaceView; label: string; href: string; icon: string }> = [
	{ id: 'pages', label: 'Pages', href: '/', icon: 'description' },
	{ id: 'graph', label: 'Graph', href: '/graph', icon: 'hub' },
]

/**
 * Workspace view switcher shown in the dashboard header. These are route
 * links (not an ARIA tab widget): each view is a real URL, so a link with
 * `aria-current="page"` is both keyboard-reachable and deep-linkable.
 */
export default function WorkspaceViewsNav ({ active }: { active: WorkspaceView }) {
	return (
		<nav
			aria-label="Workspace views"
			className="inline-flex items-center gap-1 rounded-xl border border-black/10 bg-surface-container-low p-1 dark:border-white/10"
		>
			{VIEWS.map(view => {
				const selected = view.id === active
				return (
					<Link
						key={view.id}
						href={view.href}
						aria-current={selected ? 'page' : undefined}
						className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium premium-transition ${FOCUS_RING} ${selected
							? 'bg-primary-container font-bold text-on-primary-container shadow-sm'
							: 'text-on-surface-variant hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10'
							}`}
					>
						<span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">{view.icon}</span>
						{view.label}
					</Link>
				)
			})}
		</nav>
	)
}
