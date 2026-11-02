'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, X } from 'lucide-react'
import { fetchPageBacklinks } from '@/services/graph'
import { buildBacklinkContext } from '@/lib/backlinks/context'
import type { Backlink } from '@/types'

export interface BacklinkRow {
	/** Linking page id. Empty/null marks an unresolved (title-only) row. */
	pageId?: string | null
	title: string
	/** Optional one-line context derived from the linking page body. */
	context?: string
}

interface BacklinkListProps {
	rows: BacklinkRow[]
	onNavigate: (pageId: string) => void
}

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Presentational list shared by the drawer and its tests. Resolved rows are
 * real buttons so they are keyboard reachable; unresolved rows stay inert
 * (the graph never invents a destination for a target that has no page).
 */
export function BacklinkList ({ rows, onNavigate }: BacklinkListProps) {
	return (
		<ul role="list" aria-label="Backlinks" className="flex flex-col gap-1">
			{rows.map((row) => {
				const resolved = Boolean(row.pageId)
				const content = (
					<>
						<span className="block truncate text-sm font-semibold text-on-surface">{row.title}</span>
						{row.context && (
							<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-on-surface-variant">{row.context}</p>
						)}
						{!resolved && (
							<span className="mt-1 inline-flex items-center rounded-full bg-on-surface/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
								Unresolved
							</span>
						)}
					</>
				)

				return (
					<li key={`${row.pageId || 'unresolved'}:${row.title}`}>
						{resolved ? (
							<button
								type="button"
								onClick={() => onNavigate(row.pageId as string)}
								className="w-full rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-black/10 hover:bg-black/5 dark:hover:border-white/10 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container"
							>
								{content}
							</button>
						) : (
							<div
								aria-disabled="true"
								className="w-full rounded-lg border border-dashed border-black/10 px-3 py-2 text-left opacity-80 dark:border-white/10"
							>
								{content}
							</div>
						)}
					</li>
				)
			})}
		</ul>
	)
}

interface BacklinkPaneProps {
	pageId: string
	onClose: () => void
	/**
	 * Title of the page whose backlinks are shown. Used as the match target for
	 * the optional 120-char context line; without it rows stay title-only.
	 */
	pageTitle?: string
	/**
	 * Optional linking-page bodies keyed by page id. The v1 editor passes none
	 * because `fetchPageBacklinks` carries titles only; when a caller does have
	 * bodies, each row gains a 120-char context line. The backlink query itself
	 * is never widened to fetch bodies.
	 */
	bodyByPage?: Readonly<Record<string, string>>
}

/**
 * Right-side backlink drawer (Graph spec GV-T3).
 *
 * Mounted lazily by `editor-workspace` (next/dynamic) and reads the existing
 * `fetchPageBacklinks` query — this component adds no new backlink query and
 * no write path. Focus is trapped while it is mounted and returned to the
 * trigger on close; Escape and the labelled close button both dismiss it.
 */
export default function BacklinkPane ({ pageId, pageTitle, onClose, bodyByPage }: BacklinkPaneProps) {
	const router = useRouter()
	const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
	const [backlinks, setBacklinks] = useState<Backlink[]>([])
	const [reloadKey, setReloadKey] = useState(0)
	const panelRef = useRef<HTMLDivElement>(null)
	const closeRef = useRef<HTMLButtonElement>(null)
	const restoreFocusRef = useRef<HTMLElement | null>(null)

	useEffect(() => {
		let active = true
		setStatus('loading')

		fetchPageBacklinks(pageId)
			.then((result) => {
				if (!active) return
				setBacklinks(result || [])
				setStatus('ready')
			})
			.catch((error) => {
				if (!active) return
				console.error('Failed to load backlinks:', error)
				setStatus('error')
			})

		return () => { active = false }
	}, [pageId, reloadKey])

	// Derive rows without refetching when optional bodies arrive: the query is
	// always the same `fetchPageBacklinks(pageId)` read.
	const rows = useMemo<BacklinkRow[]>(() => backlinks.map((backlink) => ({
		pageId: backlink.from_page_id || null,
		title: backlink.from_title,
		context: pageTitle
			? buildBacklinkContext(bodyByPage?.[backlink.from_page_id], pageTitle)
			: undefined,
	})), [backlinks, bodyByPage, pageTitle])

	useEffect(() => {
		restoreFocusRef.current = document.activeElement as HTMLElement | null
		closeRef.current?.focus()
		return () => {
			const previous = restoreFocusRef.current
			if (previous?.isConnected) {
				previous.focus()
				return
			}
			// The mobile menu item unmounts when it opens the drawer; fall back
			// to a stable trigger so focus never lands on <body>.
			const triggers = Array.from(document.querySelectorAll<HTMLElement>('[data-backlink-trigger]'))
			const visible = triggers.find((trigger) => trigger.offsetParent !== null) ?? triggers[0]
			visible?.focus()
		}
	}, [])

	const handleNavigate = useCallback((targetPageId: string) => {
		router.push(`/page/${targetPageId}`)
	}, [router])

	const handleKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
		// Modal: block the editor/search global shortcuts while the drawer is up.
		const isGlobalShortcut = (event.metaKey || event.ctrlKey) && ['k', 'l', 's', 'S'].includes(event.key)
		if (isGlobalShortcut) {
			event.preventDefault()
			event.stopImmediatePropagation()
			return
		}

		if (event.key === 'Escape') {
			event.preventDefault()
			event.stopPropagation()
			onClose()
			return
		}
		if (event.key !== 'Tab') return

		const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) || [])
		if (focusable.length === 0) return

		const first = focusable[0]
		const last = focusable[focusable.length - 1]
		const active = document.activeElement
		const insidePanel = Boolean(panelRef.current?.contains(active))

		if (event.shiftKey) {
			if (!insidePanel || active === first) {
				event.preventDefault()
				last.focus()
			}
		} else if (!insidePanel || active === last) {
			event.preventDefault()
			first.focus()
		}
	}, [onClose])

	// Capture phase so a click that blurs to <body> cannot route Tab/Escape to
	// the editor behind the backdrop.
	useEffect(() => {
		document.addEventListener('keydown', handleKeyDown, true)
		return () => document.removeEventListener('keydown', handleKeyDown, true)
	}, [handleKeyDown])

	return (
		<>
			<div
				className="fixed inset-0 z-50 bg-black/30"
				onClick={onClose}
				aria-hidden="true"
				data-testid="backlink-pane-backdrop"
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="backlink-pane-title"
				className="fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l border-black/10 bg-background shadow-2xl dark:border-white/10 md:w-[400px]"
			>
				<header className="flex flex-none items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
					<div className="flex items-center gap-2">
						<Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
						<h2 id="backlink-pane-title" className="text-lg font-semibold text-on-surface">Backlinks</h2>
					</div>
					<button
						ref={closeRef}
						type="button"
						onClick={onClose}
						aria-label="Close backlinks"
						className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container"
					>
						<X className="h-5 w-5" aria-hidden="true" />
					</button>
				</header>

				<div className="flex-1 overflow-y-auto p-2">
					{status === 'loading' && (
						<div role="status" aria-label="Loading backlinks" aria-live="polite" className="flex flex-col gap-2 p-1">
							<span className="sr-only">Loading backlinks</span>
							{[0, 1, 2].map((index) => (
								<div
									key={index}
									aria-hidden="true"
									className="animate-pulse rounded-lg border border-black/5 bg-surface-container-low p-3 dark:border-white/5"
								>
									<div className="h-3.5 w-2/3 rounded bg-on-surface/10" />
									<div className="mt-2 h-3 w-full rounded bg-on-surface/10" />
								</div>
							))}
						</div>
					)}

					{status === 'error' && (
						<div role="alert" className="flex flex-col items-center gap-2 p-6 text-center">
							<p className="text-sm font-semibold text-on-surface">Couldn&apos;t load backlinks.</p>
							<button
								type="button"
								onClick={() => setReloadKey((key) => key + 1)}
								className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container"
							>
								Try again
							</button>
						</div>
					)}

					{status === 'ready' && rows.length === 0 && (
						<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
							<Link2 className="h-6 w-6 text-on-surface-variant/60" aria-hidden="true" />
							<p className="text-sm font-semibold text-on-surface">No backlinks yet</p>
							<p className="text-xs text-on-surface-variant">Pages that link to this one will appear here.</p>
						</div>
					)}

					{status === 'ready' && rows.length > 0 && (
						<BacklinkList rows={rows} onNavigate={handleNavigate} />
					)}
				</div>
			</div>
		</>
	)
}
