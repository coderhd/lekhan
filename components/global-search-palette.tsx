'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { supabase } from '@/lib/supabase'
import { fetchRecentPages, searchPages } from '@/services/search'
import { toast } from 'sonner'

const DEBOUNCE_MS = 200
const SEARCH_LIMIT = 15
const RECENT_LIMIT = 8

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
	const [open, setOpen] = useState(false)
	const [userId, setUserId] = useState<string | null>(null)
	const [query, setQuery] = useState('')
	const [rows, setRows] = useState<SearchRow[]>([])
	const [loading, setLoading] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(0)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const requestIdRef = useRef(0)

	const openPalette = useCallback(() => {
		if (!userId) return
		setQuery('')
		setRows([])
		setSelectedIndex(0)
		setOpen(true)
	}, [userId])

	// Cmd/Ctrl+K opens the palette anywhere on authenticated pages.
	useEffect(() => {
		const handler = (e: globalThis.KeyboardEvent) => {
			if (!userId) return
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault()
				openPalette()
			}
		}
		document.addEventListener('keydown', handler)
		return () => document.removeEventListener('keydown', handler)
	}, [openPalette])

	// Track the authenticated user; render nothing (and never open) when signed out.
	useEffect(() => {
		let mounted = true
		supabase.auth.getSession().then(({ data: { session } }) => {
			if (mounted) setUserId(session?.user?.id ?? null)
		})
		const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
			if (mounted) {
				setUserId(session?.user?.id ?? null)
				if (!session) setOpen(false)
			}
		})
		return () => {
			mounted = false
			subscription.unsubscribe()
		}
	}, [])

	// Debounced fetch: recent pages when the query is empty, ranked results when querying.
	useEffect(() => {
		if (!userId || !open) return
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
			} catch (err) {
				if (requestId !== requestIdRef.current) return
				console.error('Global search failed:', err)
				toast.error('Search failed. Please try again.')
				setRows([])
			} finally {
				if (requestId === requestIdRef.current) setLoading(false)
			}
		}, DEBOUNCE_MS)
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [query, userId, open])

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

	return (
		<GlobalSearchContext.Provider value={{ open: openPalette }}>
			{children}
			{userId && (
				<Dialog.Root open={open} onOpenChange={setOpen}>
					<Dialog.Portal>
						<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99999] animate-in fade-in" />
						<Dialog.Content className="fixed top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-xl bg-surface-container rounded-2xl border border-black/10 dark:border-white/10 shadow-2xl z-[100000] animate-in zoom-in-95">
							<div className="flex items-center gap-xs px-4 py-3 border-b border-black/5 dark:border-white/5">
								<span className="material-symbols-outlined text-on-surface-variant shrink-0">search</span>
								<input
									type="text"
									autoFocus
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									onKeyDown={onInputKeyDown}
									className="w-full bg-transparent outline-none text-on-surface placeholder:text-on-surface-variant/50"
									placeholder="Search pages, tags, links…"
								/>
							</div>
							<div className="max-h-[50vh] overflow-y-auto py-2">
								{loading ? (
									<div className="px-4 py-3 text-sm text-on-surface-variant">Searching…</div>
								) : rows.length === 0 ? (
									<div className="px-4 py-3 text-sm text-on-surface-variant">
										{query.trim() ? 'No pages match your search.' : 'No recent pages.'}
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
							<div className="px-4 py-2 border-t border-black/5 dark:border-white/5 text-xs text-on-surface-variant">
								↑↓ navigate · Enter open · Esc close
							</div>
						</Dialog.Content>
					</Dialog.Portal>
				</Dialog.Root>
			)}
		</GlobalSearchContext.Provider>
	)
}