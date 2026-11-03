'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { supabase } from '@/lib/supabase'
import { fetchRecentPages, searchPages } from '@/services/search'
import { useSessionReauth } from '@/components/session-reauth-provider'
import ShortcutHelpDialog from '@/components/shortcut-help-dialog'
import { isTypingTarget } from '@/lib/shortcuts'
import { toast } from 'sonner'

const DEBOUNCE_MS = 200
const SEARCH_LIMIT = 15
const RECENT_LIMIT = 8
const OPEN_DIALOG_SELECTOR = '[role="dialog"][data-state="open"]'

// The palette and the shortcut sheet share one "modal slot": either may hand
// off to the other, but neither may stack over an unrelated dialog. Tagging
// each content node lets both open paths apply the same rule.
function openDialog (): { isOpen: boolean, kind: string | null } {
	const el = document.querySelector<HTMLElement>(OPEN_DIALOG_SELECTOR)
	return { isOpen: el !== null, kind: el?.dataset.modal ?? null }
}

type SearchRow = {
	id: string
	title: string
	icon: string | null
	updated_at: string
	context: string | null
}

const GlobalSearchContext = createContext<{ open: () => void } | null>(null)

export function useGlobalSearch () {
	const ctx = useContext(GlobalSearchContext)
	if (!ctx) {
		throw new Error('useGlobalSearch must be used within GlobalSearchPalette')
	}
	return ctx
}

export default function GlobalSearchPalette ({ children }: { children: ReactNode }) {
	const router = useRouter()
	const { isLocked } = useSessionReauth()
	const [open, setOpen] = useState(false)
	const [helpOpen, setHelpOpen] = useState(false)
	const [userId, setUserId] = useState<string | null>(null)
	const [query, setQuery] = useState('')
	const [rows, setRows] = useState<SearchRow[]>([])
	const [loadError, setLoadError] = useState(false)
	const [reloadKey, setReloadKey] = useState(0)
	const [loading, setLoading] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(0)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const requestIdRef = useRef(0)
	// Focus target captured before the first modal in a handoff chain opens.
	// The palette footer button is unmounted when help takes over, so help
	// cannot recover "where the user was" from document.activeElement alone.
	const modalOpenerRef = useRef<HTMLElement | null>(null)

	const rememberOpener = useCallback(() => {
		// Only the first modal in a chain owns the return target: when the
		// palette hands off to help, keep the element focused before the
		// palette opened rather than the footer button that is about to unmount.
		if (document.querySelector(OPEN_DIALOG_SELECTOR)) return
		modalOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
	}, [])

	const openPalette = useCallback(() => {
		if (!userId || isLocked) return
		rememberOpener()
		setQuery('')
		setRows([])
		setSelectedIndex(0)
		setHelpOpen(false)
		setOpen(true)
	}, [userId, isLocked, rememberOpener])

	// Opening help from the palette closes the palette: one modal at a time.
	// The return target is preserved across the handoff (see rememberOpener).
	const openHelp = useCallback(() => {
		rememberOpener()
		setOpen(false)
		setHelpOpen(true)
	}, [rememberOpener])

	// Cmd/Ctrl+K opens the palette anywhere on authenticated, unlocked pages;
	// `?` opens the shortcut list. Single-key shortcuts must not steal a
	// character from a text field — `?` while typing stays a question mark.
	useEffect(() => {
		const handler = (e: globalThis.KeyboardEvent) => {
			if (!userId || isLocked) return
			const dialog = openDialog()
			// The palette and help are one mutually-exclusive slot: swapping
			// between them is allowed, stacking over any other dialog is not.
			const maySwapModal = !dialog.isOpen || dialog.kind === 'palette' || dialog.kind === 'shortcut-help'
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				if (!maySwapModal) return
				e.preventDefault()
				openPalette()
				return
			}
			if (e.metaKey || e.ctrlKey || e.altKey) return
			if (e.key === '?' && !isTypingTarget(e.target) && !isTypingTarget(document.activeElement)) {
				if (!maySwapModal) return
				e.preventDefault()
				openHelp()
			}
		}
		document.addEventListener('keydown', handler)
		return () => document.removeEventListener('keydown', handler)
	}, [openPalette, openHelp, userId, isLocked])

	// Track the authenticated user; render nothing (and never open) when signed out.
	useEffect(() => {
		let mounted = true
		supabase.auth.getSession().then(({ data: { session } }) => {
			if (mounted) setUserId(session?.user?.id ?? null)
		})
		const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
			if (mounted) {
				setUserId(session?.user?.id ?? null)
				if (!session) {
					setOpen(false)
					setHelpOpen(false)
				}
			}
		})
		return () => {
			mounted = false
			subscription.unsubscribe()
		}
	}, [])

	// Close the palette and help if the reauth lock engages while they are open.
	useEffect(() => {
		if (isLocked) {
			setOpen(false)
			setHelpOpen(false)
		}
	}, [isLocked])

	// Debounced fetch: recent pages when the query is empty, ranked results when querying.
	useEffect(() => {
		if (!userId || !open || isLocked) return
		const requestId = ++requestIdRef.current
		setLoading(true)
		setLoadError(false)
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
			} catch (err) {
				if (requestId !== requestIdRef.current) return
				console.error('Global search failed:', err)
				toast.error('Search failed. Please try again.')
				setRows([])
				setLoadError(true)
			} finally {
				if (requestId === requestIdRef.current) setLoading(false)
			}
		}, DEBOUNCE_MS)
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [query, userId, open, isLocked, reloadKey])

	const handleSelect = useCallback((row: SearchRow) => {
		setOpen(false)
		router.push(`/page/${row.id}`)
	}, [router])

	const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setSelectedIndex(prev => Math.min(prev + 1, rows.length - 1))
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setSelectedIndex(prev => Math.max(prev - 1, 0))
		} else if (e.key === 'Enter') {
			e.preventDefault()
			const row = rows[selectedIndex]
			if (row) handleSelect(row)
		}
	}

	const echoedQuery = query.trim().length > 40 ? `${query.trim().slice(0, 40)}…` : query.trim()

	return (
		<GlobalSearchContext.Provider value={{ open: openPalette }}>
			{children}
			{userId && !isLocked && (
				<Dialog.Root open={open} onOpenChange={setOpen}>
					<Dialog.Portal>
						<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99999] animate-in fade-in" />
						<Dialog.Content data-modal="palette" className="fixed top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-xl bg-surface-container rounded-2xl border border-black/10 dark:border-white/10 shadow-2xl z-[100000] animate-in zoom-in-95">
							<Dialog.Title className="sr-only">Search pages</Dialog.Title>
							<div className="flex items-center gap-xs px-4 py-3 border-b border-black/5 dark:border-white/5">
								<span className="material-symbols-outlined text-on-surface-variant shrink-0">search</span>
								<input
									type="text"
									autoFocus
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									onKeyDown={onInputKeyDown}
									aria-label="Search pages"
									className="w-full bg-transparent outline-none text-on-surface placeholder:text-on-surface-variant/50"
									placeholder="Search pages, tags, links…"
								/>
							</div>
							<div className="max-h-[50vh] overflow-y-auto py-2">
								{loading ? (
									<div className="px-4 py-3 text-sm text-on-surface-variant">Searching…</div>
								) : loadError ? (
									<div className="px-4 py-3 text-sm text-on-surface-variant">
										<span className="block font-medium text-on-surface">
											{query.trim() ? 'Couldn’t search right now.' : 'Couldn’t load recent pages.'}
										</span>
										<span className="mt-1 block">Check your connection and try again.</span>
										<button
											type="button"
											onClick={() => setReloadKey(key => key + 1)}
											className="mt-2 inline-flex min-h-11 items-center rounded-md px-3 font-medium text-primary transition-colors hover:bg-primary/10"
										>
											Try again
										</button>
									</div>
								) : rows.length === 0 ? (
									<div className="px-4 py-3 text-sm text-on-surface-variant">
										{query.trim() ? (
											<>
												<span className="block font-medium text-on-surface">No pages match “{echoedQuery}”.</span>
												<span className="mt-1 block">Try a shorter word, or search for a page title instead.</span>
											</>
										) : (
											<>
												<span className="block font-medium text-on-surface">Nothing to quick-switch yet.</span>
												<span className="mt-1 block">Open or create a page and it will show up here.</span>
											</>
										)}
									</div>
								) : (
									rows.map((row, idx) => (
										<button
											key={row.id}
											type="button"
											onClick={() => handleSelect(row)}
											onMouseEnter={() => setSelectedIndex(idx)}
											className={`w-full flex items-center gap-sm px-4 py-2 text-left premium-transition ${
												idx === selectedIndex ? 'bg-primary/10 text-on-primary' : 'text-on-surface'
											}`}
										>
											<span className="material-symbols-outlined text-base shrink-0">{row.icon || 'description'}</span>
											<span className="flex-1 min-w-0">
												<span className="block truncate text-sm font-medium">{row.title}</span>
												{row.context && <span className="block truncate text-xs text-on-surface-variant">{row.context}</span>}
											</span>
											<span className="text-xs text-on-surface-variant shrink-0">{new Date(row.updated_at).toLocaleDateString()}</span>
										</button>
									))
								)}
							</div>
							<div className="px-4 py-2 border-t border-black/5 dark:border-white/5 flex items-center justify-between gap-sm text-xs text-on-surface-variant">
								<span>↑↓ navigate · Enter open · Esc close</span>
								<button
									type="button"
									onClick={openHelp}
									className="flex min-h-11 items-center gap-1.5 rounded-md px-2 font-medium transition-colors hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10"
								>
									<kbd className="inline-flex min-w-[1.4rem] items-center justify-center rounded border border-black/10 bg-surface-container-high px-1 font-mono text-[11px] font-semibold dark:border-white/15">?</kbd>
									Shortcuts
								</button>
							</div>
						</Dialog.Content>
					</Dialog.Portal>
				</Dialog.Root>
			)}
			{userId && !isLocked && (
				<ShortcutHelpDialog
					open={helpOpen}
					onOpenChange={setHelpOpen}
					returnFocusTo={modalOpenerRef.current}
				/>
			)}
		</GlobalSearchContext.Provider>
	)
}
