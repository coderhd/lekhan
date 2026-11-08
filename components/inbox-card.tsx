'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Inbox as InboxIcon, RefreshCw } from 'lucide-react'
import { fetchInboxItems, type InboxItem } from '@/lib/inbox'
import { dailyTitle, ensureDailyPage } from '@/lib/daily-notes'

const FOCUS_RING =
	'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2'

export interface InboxCardProps {
	workspaceId: string | null
	ownerId: string
	/** Injection seam for tests and deterministic renders. */
	today?: Date
}

/**
 * Dashboard Inbox summary (epic #39, DN-T3).
 *
 * Counts pending captures (`#inbox` bullets) in the workspace's daily pages of
 * the last 14 days and shows the five newest. "Open Inbox" resolves today's
 * daily page (creating it when missing) and routes to the Inbox section.
 *
 * The graph index behind `fetchInboxItems` is refreshed by the hub's idle save,
 * so the card also refetches when the tab regains focus. Failures stay visible
 * with a retry instead of pretending the inbox is empty.
 */
export default function InboxCard ({ workspaceId, ownerId, today }: InboxCardProps) {
	const router = useRouter()

	const [items, setItems] = useState<InboxItem[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState(false)
	const [opening, setOpening] = useState(false)
	const [openError, setOpenError] = useState(false)

	const requestIdRef = useRef(0)
	const mountedRef = useRef(true)

	useEffect(() => {
		mountedRef.current = true
		return () => { mountedRef.current = false }
	}, [])

	const load = useCallback(async (quiet = false) => {
		if (!workspaceId) {
			setItems([])
			setLoading(false)
			setError(false)
			return
		}

		const requestId = ++requestIdRef.current
		if (!quiet) setLoading(true)
		setError(false)

		try {
			const next = await fetchInboxItems(workspaceId, { now: today ?? new Date() })
			if (!mountedRef.current || requestId !== requestIdRef.current) return
			setItems(next)
		} catch (err) {
			if (!mountedRef.current || requestId !== requestIdRef.current) return
			console.error('Failed to load inbox:', err)
			setError(true)
		} finally {
			if (mountedRef.current && requestId === requestIdRef.current) {
				setLoading(false)
			}
		}
	}, [today, workspaceId])

	useEffect(() => {
		void load()
	}, [load])

	// A capture lands in the page body immediately, but the graph index that
	// this card reads updates on the hub's idle save. Refetch when the tab
	// regains focus, and retry briefly after the palette reports a capture so
	// the count does not race the indexer.
	useEffect(() => {
		let timers: number[] = []
		const clearTimers = () => {
			for (const timer of timers) window.clearTimeout(timer)
			timers = []
		}
		const refresh = () => { void load(true) }
		const refreshAfterCapture = () => {
			clearTimers()
			refresh()
			timers = [
				window.setTimeout(refresh, 2_500),
				window.setTimeout(refresh, 6_000),
			]
		}
		const onVisibility = () => {
			if (document.visibilityState === 'visible') refresh()
		}
		window.addEventListener('focus', refresh)
		window.addEventListener('lekhan:inbox-changed', refreshAfterCapture)
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			clearTimers()
			window.removeEventListener('focus', refresh)
			window.removeEventListener('lekhan:inbox-changed', refreshAfterCapture)
			document.removeEventListener('visibilitychange', onVisibility)
		}
	}, [load])

	// A dashboard tab can stay open across local midnight; the 14-day window
	// must move with the user's day, not the mount time.
	const dayRef = useRef(dailyTitle(new Date()))
	useEffect(() => {
		if (today) return
		const interval = window.setInterval(() => {
			const current = dailyTitle(new Date())
			if (current !== dayRef.current) {
				dayRef.current = current
				void load(true)
			}
		}, 60_000)
		return () => window.clearInterval(interval)
	}, [load, today])

	const openInbox = useCallback(async () => {
		if (!workspaceId || opening) return

		setOpening(true)
		setOpenError(false)
		try {
			const page = await ensureDailyPage({ id: workspaceId, owner_id: ownerId }, today ?? new Date())
			router.push(`/page/${page.id}?section=inbox`)
		} catch (err) {
			console.error('Failed to open the daily Inbox:', err)
			if (mountedRef.current) setOpenError(true)
		} finally {
			if (mountedRef.current) setOpening(false)
		}
	}, [opening, ownerId, router, today, workspaceId])

	const preview = items.slice(0, 5)
	const remaining = items.length - preview.length

	return (
		<section
			aria-labelledby="inbox-card-heading"
			aria-busy={loading}
			className="w-full rounded-2xl border border-black/10 dark:border-white/10 bg-surface-container-low px-4 py-3"
		>
			<div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
				<div className="flex items-center gap-2">
					<InboxIcon aria-hidden className="h-4 w-4 text-primary" />
					<h2 id="inbox-card-heading" className="font-semibold text-on-surface">Inbox</h2>
					<span
						aria-live="polite"
						aria-label={
							loading
								? 'Loading pending captures'
								: error
									? 'Inbox unavailable'
									: `${items.length} pending captures`
						}
						className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary"
					>
						{loading ? '…' : error ? '!' : items.length}
					</span>
				</div>

				<button
					type="button"
					aria-label="Open today's Inbox"
					onClick={() => { void openInbox() }}
					disabled={opening || loading}
					className={`flex min-h-11 items-center gap-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-surface px-3 py-2 text-sm font-medium text-on-surface hover:bg-black/5 dark:hover:bg-white/5 premium-transition disabled:opacity-60 ${FOCUS_RING}`}
				>
					{opening ? (
						<RefreshCw aria-hidden className="h-4 w-4 animate-spin" />
					) : (
						<ArrowRight aria-hidden className="h-4 w-4" />
					)}
					<span>Open Inbox</span>
				</button>
			</div>

			{/* Five single-line previews plus the overflow count fit in the same
			   reserved region as loading, empty and retry states. */}
			<div className="mt-3 min-h-48">
				{loading ? (

					<div role="status" className="rounded-lg border border-dashed border-black/10 dark:border-white/10 px-3 py-4 text-sm">
						<p className="font-medium text-on-surface">Loading captures…</p>
						<p className="text-on-surface-variant">Captures land here until you link or delete them. Tags organise them without clearing the inbox.</p>
					</div>
				) : error ? (
					<div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-error/10 px-3 py-2 text-sm">
						<span className="text-error">Couldn't load your inbox. Check your connection and try again.</span>
						<button
							type="button"
							onClick={() => { void load() }}
							className={`flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-bold text-on-primary hover:bg-primary/90 premium-transition ${FOCUS_RING}`}
						>
							Try again
						</button>
					</div>
				) : items.length === 0 ? (
					<div className="rounded-lg border border-dashed border-black/10 dark:border-white/10 px-3 py-4 text-sm text-on-surface-variant">
						<p className="font-medium text-on-surface">Inbox zero</p>
						<p>Captures land here until you link or delete them. Tags organise them without clearing the inbox.</p>
					</div>
				) : (
					<>
						<ul aria-label="Pending captures" className="flex flex-col gap-1">
							{preview.map((entry, index) => (
								<li
									key={`${entry.pageId}-${index}-${entry.text}`}
									className="flex min-w-0 items-baseline gap-2 rounded-lg px-2 py-1 text-sm text-on-surface"
								>
									<span className="shrink-0 text-xs text-on-surface-variant">{entry.pageTitle}</span>
									<span className="min-w-0 truncate">{entry.text}</span>
								</li>
							))}
						</ul>
						{remaining > 0 && (
							<p className="mt-1 px-2 text-xs text-on-surface-variant">
								+{remaining} more pending
							</p>
						)}
					</>
				)}

				{openError && (
					<p role="alert" className="mt-2 text-sm text-error">
						Could not open today's daily page. Check your connection and try again.
					</p>
				)}
			</div>
		</section>
	)
}
