'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { dailyTitle, ensureDailyPage, fetchDailyPages, shiftDailyDate } from '@/lib/daily-notes'
import type { Page } from '@/types'

const longDateFormatter = new Intl.DateTimeFormat('en', {
	weekday: 'long',
	year: 'numeric',
	month: 'long',
	day: 'numeric',
})
const weekdayFormatter = new Intl.DateTimeFormat('en', { weekday: 'short' })
const shortDateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })

const STRIP_DAYS = 7

/** The visible week: STRIP_DAYS dates centred on `date`. */
function visibleDaysAround (date: Date): Date[] {
	const start = shiftDailyDate(date, -Math.floor(STRIP_DAYS / 2))
	return Array.from({ length: STRIP_DAYS }, (_, index) => shiftDailyDate(start, index))
}

export interface DailyStripProps {
	workspaceId: string | null
	ownerId: string
	/**
	 * Injection seam for tests and deterministic renders. Production omits it
	 * and the strip uses the client-local "today" (the spec's timezone decision).
	 */
	today?: Date
}

/**
 * Dashboard daily-notes affordance: today's date, previous/next day arrows, and
 * a week of day buttons whose dots mark dates that already have a daily page.
 * Opening a date reuses its page or auto-creates it, then redirects to
 * `/page/[id]`. Keyboard-reachable throughout (native buttons + labels).
 */
export default function DailyStrip ({ workspaceId, ownerId, today }: DailyStripProps) {
	const router = useRouter()
	const [todayDate] = useState(() => shiftDailyDate(today ?? new Date(), 0))
	const [selectedDate, setSelectedDate] = useState<Date>(todayDate)
	const [pages, setPages] = useState<Map<string, Page>>(() => new Map())
	const [busy, setBusy] = useState(false)
	const [failedDate, setFailedDate] = useState<Date | null>(null)

	const selectedTitle = dailyTitle(selectedDate)
	const selectedPage = pages.get(selectedTitle)
	const isToday = selectedTitle === dailyTitle(todayDate)

	// The visible week is centred on the selected day, so arrow navigation
	// moves the window with the selection.
	const days = useMemo(() => visibleDaysAround(selectedDate), [selectedDate])

	useEffect(() => {
		if (!workspaceId) {
			setPages(new Map())
			return
		}

		let cancelled = false
		fetchDailyPages(workspaceId, visibleDaysAround(selectedDate))
			.then(next => {
				if (!cancelled) setPages(next)
			})
			.catch(error => {
				// Dots are an enhancement: a failed load must not break the
				// strip or block creating today's page.
				console.error('Failed to load daily page dots:', error)
				if (!cancelled) setPages(new Map())
			})

		return () => { cancelled = true }
	}, [workspaceId, selectedDate])

	const openDay = useCallback(async (date: Date) => {
		if (!workspaceId || busy) return
		setFailedDate(null)

		const existing = pages.get(dailyTitle(date))
		if (existing) {
			router.push(`/page/${existing.id}`)
			return
		}

		setBusy(true)
		try {
			const page = await ensureDailyPage({ id: workspaceId, owner_id: ownerId }, date)
			router.push(`/page/${page.id}`)
		} catch (error) {
			console.error('Failed to open daily page:', error)
			toast.error('Could not open that daily page. Please try again.')
			setFailedDate(date)
		} finally {
			setBusy(false)
		}
	}, [busy, ownerId, pages, router, workspaceId])

	const longSelected = longDateFormatter.format(selectedDate)
	const actionLabel = `${selectedPage ? 'Open' : 'Create'} daily page for ${longSelected}`

	/** Move the selection and dismiss any stale failure from an earlier day. */
	const moveSelection = (offset: number) => {
		setFailedDate(null)
		setSelectedDate(date => shiftDailyDate(date, offset))
	}

	return (
		<section className="w-full rounded-2xl border border-black/10 dark:border-white/10 bg-surface-container-low px-4 py-3">
			<nav aria-label="Daily notes" aria-busy={busy} className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							aria-label="Previous day"
							onClick={() => moveSelection(-1)}
							className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/10 hover:text-on-surface premium-transition"
						>
							<ChevronLeft aria-hidden className="h-4 w-4" />
						</button>

						<button
							type="button"
							aria-label={actionLabel}
							onClick={() => openDay(selectedDate)}
							disabled={busy}
							className="flex items-center gap-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-surface px-3 py-2 font-medium text-on-surface hover:bg-black/5 dark:hover:bg-white/5 premium-transition disabled:opacity-60"
						>
							<CalendarDays aria-hidden className="h-4 w-4 text-primary" />
							<span>{isToday ? 'Today' : shortDateFormatter.format(selectedDate)}</span>
							<span className="hidden text-xs text-on-surface-variant sm:inline">
								{selectedPage ? 'Open daily page' : 'Create daily page'}
							</span>
						</button>

						<button
							type="button"
							aria-label="Next day"
							onClick={() => moveSelection(1)}
							className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/10 hover:text-on-surface premium-transition"
						>
							<ChevronRight aria-hidden className="h-4 w-4" />
						</button>
					</div>

					<p className="text-xs text-on-surface-variant">
						{longSelected}
					</p>
				</div>

				<div role="group" aria-label="Days in this week" className="flex items-center justify-between gap-1">
					{days.map(day => {
						const title = dailyTitle(day)
						const hasPage = pages.has(title)
						const isSelected = title === selectedTitle
						const label = `${longDateFormatter.format(day)}${hasPage ? ', daily page exists' : ''}`

						return (
							<button
								key={title}
								type="button"
								aria-label={label}
								aria-current={isSelected ? 'date' : undefined}
								onClick={() => openDay(day)}
								disabled={busy}
								className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/10 premium-transition disabled:opacity-60 ${isSelected ? 'bg-black/5 dark:bg-white/10 text-on-surface' : ''}`}
							>
								<span aria-hidden className="text-[10px] uppercase tracking-wide">
									{weekdayFormatter.format(day).slice(0, 2)}
								</span>
								<span aria-hidden className="text-sm font-semibold text-on-surface">
									{day.getDate()}
								</span>
								<span aria-hidden className="flex h-1.5 items-center justify-center">
									{hasPage && <span data-testid="daily-dot" className="h-1.5 w-1.5 rounded-full bg-primary" />}
								</span>
							</button>
						)
					})}
				</div>
			</nav>

			{failedDate && (
				<div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-error/10 px-3 py-2 text-sm text-on-surface">
					<span>Could not open that daily page. Check your connection and try again.</span>
					<button
						type="button"
						onClick={() => openDay(failedDate)}
						className="rounded-md bg-primary px-3 py-1 text-xs font-bold text-on-primary hover:bg-primary/90 premium-transition"
					>
						Retry
					</button>
				</div>
			)}
		</section>
	)
}
