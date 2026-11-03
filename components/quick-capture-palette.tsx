'use client'

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { supabase } from '@/lib/supabase'
import { ensureWorkspace, fetchPageDetails, fetchPageMemberRole } from '@/services/graph'
import { fetchRecentPages, searchPages } from '@/services/search'
import { ensureDailyPage } from '@/lib/daily-notes'
import { appendCaptureBlock, CaptureError } from '@/lib/quick-capture'
import { useSessionReauth } from '@/components/session-reauth-provider'
import { toast } from 'sonner'

const DEBOUNCE_MS = 200
const SEARCH_LIMIT = 12
const RECENT_LIMIT = 10
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2'

type CaptureTarget = { id: string; title: string }

type PageRow = {
	id: string
	title: string
	icon: string | null
	updated_at: string
	context: string | null
}

const QuickCaptureContext = createContext<{ open: () => void } | null>(null)

/** Open the global quick-capture palette from anywhere inside the provider. */
export function useQuickCapture () {
	const context = useContext(QuickCaptureContext)
	if (!context) {
		throw new Error('useQuickCapture must be used within QuickCapturePalette')
	}
	return context
}

/**
 * Global quick capture (epic #39, DN-T2).
 *
 * `⌘⇧C` / `Ctrl+⇧+C` opens a single-input palette anywhere an authenticated,
 * unlocked session is active. Enter appends a timestamped `#inbox` bullet to
 * today's daily page through the page's CRDT channel (`appendCaptureBlock`), or
 * to a page chosen from the same search RPC behind the `[[` autocomplete.
 * Nothing is written through the server.
 */
export default function QuickCapturePalette ({ children }: { children: ReactNode }) {
	const router = useRouter()
	const { isLocked } = useSessionReauth()
	const [open, setOpen] = useState(false)
	const [userId, setUserId] = useState<string | null>(null)
	const [text, setText] = useState('')
	const [target, setTarget] = useState<CaptureTarget | null>(null)
	const [mode, setMode] = useState<'capture' | 'pick'>('capture')
	const [submitting, setSubmitting] = useState(false)
	const [query, setQuery] = useState('')
	const [rows, setRows] = useState<PageRow[]>([])
	const [loading, setLoading] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(0)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const requestIdRef = useRef(0)

	const reset = useCallback(() => {
		setText('')
		setTarget(null)
		setMode('capture')
		setQuery('')
		setRows([])
		setSelectedIndex(0)
		setSubmitting(false)
	}, [])

	const openPalette = useCallback(() => {
		if (!userId || isLocked) return
		reset()
		setOpen(true)
	}, [userId, isLocked, reset])

	// ⌘⇧C / Ctrl+⇧+C anywhere authenticated and unlocked.
	useEffect(() => {
		const handler = (event: globalThis.KeyboardEvent) => {
			if (!userId || isLocked) return
			// Match the physical C key too: on non-Latin layouts `event.key` is
			// not "c" for that key. AltGr combinations must not trigger it.
			const isC = event.code === 'KeyC' || event.key.toLowerCase() === 'c'
			if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && isC) {
				event.preventDefault()
				openPalette()
			}
		}
		document.addEventListener('keydown', handler)
		return () => document.removeEventListener('keydown', handler)
	}, [userId, isLocked, openPalette])

	// Track the authenticated user; never render (or open) when signed out.
	useEffect(() => {
		let mounted = true
		supabase.auth.getSession().then(({ data: { session } }) => {
			if (mounted) setUserId(session?.user?.id ?? null)
		})
		const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
			if (!mounted) return
			setUserId(session?.user?.id ?? null)
			if (!session) setOpen(false)
		})
		return () => {
			mounted = false
			subscription.unsubscribe()
		}
	}, [])

	// Close if the reauth lock engages while open.
	useEffect(() => {
		if (isLocked) setOpen(false)
	}, [isLocked])

	// Page picker: recent pages when empty, ranked workspace search otherwise —
	// the same `search_pages` RPC the `[[` autocomplete path uses.
	useEffect(() => {
		if (!userId || !open || mode !== 'pick' || isLocked) return
		const requestId = ++requestIdRef.current
		setLoading(true)
		if (debounceRef.current) clearTimeout(debounceRef.current)
		debounceRef.current = setTimeout(async () => {
			try {
				const trimmed = query.trim()
				const data = trimmed
					? await searchPages(trimmed, SEARCH_LIMIT)
					: (await fetchRecentPages(userId, RECENT_LIMIT)).map(page => ({
						id: page.id,
						title: page.title,
						icon: page.icon,
						updated_at: page.updated_at,
						context: null,
					}))
				if (requestId !== requestIdRef.current) return
				setRows(data)
				setSelectedIndex(0)
			} catch (error) {
				if (requestId !== requestIdRef.current) return
				console.error('Quick capture page search failed:', error)
				toast.error('Could not search pages. Please try again.')
				setRows([])
			} finally {
				if (requestId === requestIdRef.current) setLoading(false)
			}
		}, DEBOUNCE_MS)
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [query, userId, open, mode, isLocked])

	const submit = useCallback(async () => {
		const body = text.trim()
		if (!body || submitting || !userId) return

		setSubmitting(true)
		try {
			const { data: { session } } = await supabase.auth.getSession()
			const token = session?.access_token
			if (!token) {
				throw new CaptureError('forbidden', 'Sign in again to capture.')
			}

			let destination = target
			if (destination) {
				// The picker also surfaces shared read-only pages; the sync hub
				// silently drops viewer writes, so fail before connecting rather
				// than showing a success toast for a discarded capture.
				const page = await fetchPageDetails(destination.id)
				if (page.owner_id !== userId) {
					const role = await fetchPageMemberRole(destination.id, userId)
					if (role !== 'owner' && role !== 'editor') {
						throw new CaptureError('forbidden', 'No edit access to that page.')
					}
				}
			} else {
				const workspace = await ensureWorkspace(userId)
				const page = await ensureDailyPage(
					{ id: workspace.id, owner_id: workspace.owner_id },
					new Date(),
				)
				destination = { id: page.id, title: page.title }
			}

			const { bulletText } = await appendCaptureBlock({
				pageId: destination.id,
				token,
				text: body,
			})

			setOpen(false)
			reset()
			// The dashboard Inbox card reads the indexed page text; tell it a
			// capture landed so its count/top-5 refresh without a tab switch.
			window.dispatchEvent(new CustomEvent('lekhan:inbox-changed'))
			toast.success(`Captured to ${destination.title}`, {
				description: bulletText,
				action: { label: 'Open', onClick: () => router.push(`/page/${destination!.id}`) },
			})
		} catch (error) {
			// `CaptureError` messages for a rejected write are already user-facing
			// and distinct: "Sign in again to capture." (expired/invalid token)
			// versus "No edit access to that page." (viewer-only page). Keep the
			// specific instruction instead of collapsing both into one.
			const message = error instanceof CaptureError && error.code === 'forbidden'
				? error.message
				: 'Could not capture right now. Check your connection and try again.'
			toast.error(message)
		} finally {
			setSubmitting(false)
		}
	}, [text, submitting, userId, target, reset, router])

	const onCaptureKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault()
			void submit()
		}
	}

	const choosePage = (row: PageRow) => {
		setTarget({ id: row.id, title: row.title })
		setMode('capture')
		setQuery('')
		setRows([])
	}

	const onPickerKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			setSelectedIndex(previous => Math.min(previous + 1, rows.length - 1))
		} else if (event.key === 'ArrowUp') {
			event.preventDefault()
			setSelectedIndex(previous => Math.max(previous - 1, 0))
		} else if (event.key === 'Enter') {
			event.preventDefault()
			const row = rows[selectedIndex]
			if (row) choosePage(row)
		}
	}

	return (
		<QuickCaptureContext.Provider value={{ open: openPalette }}>
			{children}
			{userId && !isLocked && (
				<Dialog.Root open={open} onOpenChange={next => { if (!next) setOpen(false) }}>
					<Dialog.Portal>
						<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99999] animate-in fade-in" />
						<Dialog.Content
							className="fixed top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-xl bg-surface-container rounded-2xl border border-black/10 dark:border-white/10 shadow-2xl z-[100000] animate-in zoom-in-95"
							aria-describedby="quick-capture-description"
						>
							<Dialog.Title className="px-4 pt-4 text-sm font-bold uppercase tracking-wider text-on-surface-variant">
								Quick capture
							</Dialog.Title>
							<Dialog.Description id="quick-capture-description" className="px-4 pb-3 text-sm text-on-surface-variant">
								{mode === 'pick'
									? 'Choose the page that should receive this capture.'
									: target
										? `Sending to ${target.title}`
										: 'Enter lands in today\'s daily page Inbox.'}
							</Dialog.Description>

							{mode === 'pick' ? (
								<div className="border-t border-black/5 dark:border-white/5">
									<div className="flex items-center gap-xs px-4 py-3">
										<label htmlFor="quick-capture-page-search" className="sr-only">Find a page</label>
										<span aria-hidden className="material-symbols-outlined text-on-surface-variant shrink-0">search</span>
										<input
											id="quick-capture-page-search"
											type="text"
											autoFocus
											value={query}
											onChange={event => setQuery(event.target.value)}
											onKeyDown={onPickerKeyDown}
											placeholder="Search pages…"
											className="w-full bg-transparent outline-none text-on-surface placeholder:text-on-surface-variant/50"
										/>
									</div>
									<div className="max-h-[45vh] overflow-y-auto py-1">
										{loading ? (
											<p className="px-4 py-3 text-sm text-on-surface-variant">Searching…</p>
										) : rows.length === 0 ? (
											<p className="px-4 py-3 text-sm text-on-surface-variant">
												{query.trim() ? 'No pages match your search.' : 'No recent pages.'}
											</p>
										) : (
											rows.map((row, index) => (
												<button
													key={row.id}
													type="button"
													onClick={() => choosePage(row)}
													onMouseEnter={() => setSelectedIndex(index)}
													className={`w-full flex items-center gap-sm px-4 py-2 text-left premium-transition ${
														index === selectedIndex ? 'bg-primary/10 text-on-primary' : 'text-on-surface'
													} ${FOCUS_RING}`}
												>
													<span aria-hidden className="material-symbols-outlined text-base shrink-0">{row.icon || 'description'}</span>
													<span className="flex-1 min-w-0">
														<span className="block truncate text-sm font-medium">{row.title}</span>
														{row.context && <span className="block truncate text-xs text-on-surface-variant">{row.context}</span>}
													</span>
												</button>
											))
										)}
									</div>
								</div>
							) : (
								<div className="border-t border-black/5 dark:border-white/5">
									<label htmlFor="quick-capture-input" className="sr-only">Capture text</label>
									<div className="flex items-center gap-xs px-4 py-3">
										<span aria-hidden className="material-symbols-outlined text-on-surface-variant shrink-0">bolt</span>
										<input
											id="quick-capture-input"
											type="text"
											autoFocus
											value={text}
											onChange={event => setText(event.target.value)}
											onKeyDown={onCaptureKeyDown}
											placeholder="Capture anything… #tag and [[page]] work here"
											aria-describedby="quick-capture-hint"
											className="w-full bg-transparent outline-none text-on-surface placeholder:text-on-surface-variant/50"
										/>
									</div>
									<p id="quick-capture-hint" className="px-4 pb-3 text-xs text-on-surface-variant">
										Enter captures · Esc closes
									</p>
								</div>
							)}

							<div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/5 dark:border-white/5 px-4 py-3">
								<div className="flex items-center gap-2">
									{mode === 'pick' ? (
										<button
											type="button"
											onClick={() => setMode('capture')}
											className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/10 ${FOCUS_RING}`}
										>
											<span aria-hidden className="material-symbols-outlined text-base">arrow_back</span>
											Back to capture
										</button>
									) : (
										<>
											<button
												type="button"
												onClick={() => setMode('pick')}
												className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/10 ${FOCUS_RING}`}
											>
												<span aria-hidden className="material-symbols-outlined text-base">description</span>
												Send to a page…
											</button>
											{target && (
												<button
													type="button"
													onClick={() => setTarget(null)}
													className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/10 ${FOCUS_RING}`}
												>
													<span aria-hidden className="material-symbols-outlined text-base">close</span>
													Clear target
												</button>
											)}
										</>
									)}
								</div>

								<div className="flex items-center gap-2">
									{submitting && (
										<span role="status" className="text-xs text-on-surface-variant">
											Capturing… the sync server may be waking up.
										</span>
									)}
									<button
										type="button"
										onClick={() => setOpen(false)}
										className={`min-h-11 rounded-lg px-3 text-sm font-medium text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/10 ${FOCUS_RING}`}
									>
										Cancel
									</button>
									{mode !== 'pick' && (
										<button
											type="button"
											onClick={() => { void submit() }}
											disabled={submitting || text.trim() === ''}
											className={`min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-on-primary hover:bg-primary/90 premium-transition disabled:opacity-60 ${FOCUS_RING}`}
										>
											Capture
										</button>
									)}
								</div>
							</div>
						</Dialog.Content>
					</Dialog.Portal>
				</Dialog.Root>
			)}
		</QuickCaptureContext.Provider>
	)
}
