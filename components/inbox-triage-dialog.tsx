'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Link2, Search, Tag as TagIcon } from 'lucide-react'
import { searchPages } from '@/services/search'
import { isValidInboxTag } from '@/lib/inbox-triage'
import type { SearchResult } from '@/types'

const FOCUS_RING =
	'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2'

export type InboxTriageMode = 'link' | 'tag'

export interface InboxTriageDialogProps {
	mode: InboxTriageMode | null
	/** The focused row text, shown as context for the action. */
	rowText: string | null
	/** True while the link/tag write is in flight. */
	busy?: boolean
	onOpenChange: (open: boolean) => void
	onSelectPage: (page: SearchResult) => void
	onTag: (tag: string) => void
	/** Injection seam for tests; production uses the global search RPC. */
	search?: (query: string) => Promise<SearchResult[]>
}

/**
 * Inbox triage dialogs (epic #39, DN-T3): `o` links a capture to a page and
 * `t` adds a tag. Keyboard-first (arrow keys + Enter, Escape closes), with the
 * page search reusing the same RPC as global search / `[[` autocomplete.
 */
export default function InboxTriageDialog ({
	mode,
	rowText,
	busy = false,
	onOpenChange,
	onSelectPage,
	onTag,
	search = searchPages,
}: InboxTriageDialogProps) {
	const open = mode !== null
	const [query, setQuery] = useState('')
	const [rows, setRows] = useState<SearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [tag, setTag] = useState('')
	const requestRef = useRef(0)
	const activeRowRef = useRef<HTMLButtonElement | null>(null)
	const tagValid = isValidInboxTag(tag)

	// Reset per opening so a previous action never leaks into the next one.
	useEffect(() => {
		if (!open) return
		setQuery('')
		setRows([])
		setError(false)
		setSelectedIndex(0)
		setTag('')
	}, [open, mode])

	useEffect(() => {
		if (mode !== 'link') return

		const requestId = ++requestRef.current
		setLoading(true)
		setError(false)

		const delay = query.trim() ? 200 : 0
		const timer = window.setTimeout(() => {
			search(query.trim())
				.then(results => {
					if (requestId !== requestRef.current) return
					setRows(results)
					setSelectedIndex(0)
				})
				.catch(err => {
					console.error('Failed to search pages for inbox triage:', err)
					if (requestId !== requestRef.current) return
					setError(true)
					setRows([])
				})
				.finally(() => {
					if (requestId === requestRef.current) setLoading(false)
				})
		}, delay)

		return () => window.clearTimeout(timer)
	}, [mode, query, search])

	const chooseRow = useCallback((row: SearchResult) => {
		onSelectPage(row)
	}, [onSelectPage])

	// Keep the arrow-key selection visible inside the 45vh results viewport.
	useEffect(() => {
		const row = activeRowRef.current
		if (row && typeof row.scrollIntoView === 'function') {
			row.scrollIntoView({ block: 'nearest' })
		}
	}, [selectedIndex, rows])

	const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (busy) return
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			setSelectedIndex(previous => Math.min(previous + 1, Math.max(rows.length - 1, 0)))
		} else if (event.key === 'ArrowUp') {
			event.preventDefault()
			setSelectedIndex(previous => Math.max(previous - 1, 0))
		} else if (event.key === 'Enter') {
			event.preventDefault()
			const row = rows[selectedIndex]
			if (row) chooseRow(row)
		}
	}

	const submitTag = () => {
		if (busy || !tagValid) return
		const value = tag.trim().replace(/^#+/, '')
		if (!value) return
		onTag(value)
	}

	const onTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Enter') {
			event.preventDefault()
			submitTag()
		}
	}

	return (
		<Dialog.Root open={open} onOpenChange={next => { if (!next) onOpenChange(false) }}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm animate-in fade-in" />
				<Dialog.Content
					className="fixed left-1/2 top-1/4 z-[100000] w-[92vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-black/10 bg-surface-container shadow-2xl animate-in zoom-in-95 dark:border-white/10"
					data-testid="inbox-triage-dialog"
					aria-busy={busy}
				>
					<Dialog.Title className="flex items-center gap-2 px-4 pt-4 text-sm font-bold uppercase tracking-wider text-on-surface-variant">
						{mode === 'tag' ? (
							<>
								<TagIcon aria-hidden className="h-4 w-4" />
								Add a tag to this capture
							</>
						) : (
							<>
								<Link2 aria-hidden className="h-4 w-4" />
								Link this capture to a page
							</>
						)}
					</Dialog.Title>
					<Dialog.Description className="px-4 pb-3 text-sm text-on-surface-variant">
						{rowText ?? 'Focused inbox capture'}
					</Dialog.Description>

					{mode === 'tag' ? (
						<div className="border-t border-black/5 px-4 py-3 dark:border-white/5">
							<label htmlFor="inbox-triage-tag" className="sr-only">Tag</label>
							<input
								id="inbox-triage-tag"
								type="text"
								autoFocus
								value={tag}
								onChange={event => setTag(event.target.value)}
								onKeyDown={onTagKeyDown}
								disabled={busy}
								placeholder="tag-name"
								aria-invalid={tag.trim() !== '' && !tagValid}
								aria-describedby="inbox-triage-tag-hint"
								className="w-full rounded-lg bg-black/5 px-3 py-2 text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:ring-2 focus:ring-primary-container/50 dark:bg-white/5"
							/>
							<p id="inbox-triage-tag-hint" className="mt-2 text-xs text-on-surface-variant">
								{tag.trim() !== '' && !tagValid
									? 'Use one tag: letters, numbers, _, - or / (for example launch).'
									: 'Adds #tag to the row. It stays in the Inbox until linked or deleted.'}
							</p>
						</div>
					) : (
						<div className="border-t border-black/5 dark:border-white/5">
							<div className="flex items-center gap-2 px-4 py-3">
								<label htmlFor="inbox-triage-search" className="sr-only">Find a page</label>
								<Search aria-hidden className="h-4 w-4 shrink-0 text-on-surface-variant" />
								<input
									id="inbox-triage-search"
									type="text"
									autoFocus
									value={query}
									onChange={event => setQuery(event.target.value)}
									onKeyDown={onSearchKeyDown}
									disabled={busy}
									placeholder="Search pages…"
									className="w-full bg-transparent text-on-surface outline-none placeholder:text-on-surface-variant/50"
								/>
							</div>
							<p className="sr-only" aria-live="polite">
								{rows[selectedIndex]?.title ?? ''}
							</p>
							<div className="max-h-[45vh] overflow-y-auto py-1">
								{loading ? (
									<p role="status" className="px-4 py-3 text-sm text-on-surface-variant">Searching…</p>
								) : error ? (
									<div role="alert" className="px-4 py-3 text-sm text-error">
										Couldn't search pages. Check your connection and try again.
									</div>
								) : rows.length === 0 ? (
									<p className="px-4 py-3 text-sm text-on-surface-variant">
										{query.trim() ? 'No pages match your search.' : 'No pages yet. Start typing to search.'}
									</p>
								) : (
									rows.map((row, index) => (
										<button
											key={row.id}
											type="button"
											ref={index === selectedIndex ? activeRowRef : undefined}
											onClick={() => chooseRow(row)}
											onMouseEnter={() => setSelectedIndex(index)}
											disabled={busy}
											aria-label={`Link to ${row.title}`}
											aria-current={index === selectedIndex ? 'true' : undefined}
											className={`flex w-full items-center gap-2 px-4 py-2 text-left premium-transition ${
												index === selectedIndex
													? 'bg-primary/10 text-on-surface'
													: 'text-on-surface'
											} ${FOCUS_RING}`}
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-sm font-medium">{row.title}</span>
												{row.context && (
													<span className="block truncate text-xs text-on-surface-variant">{row.context}</span>
												)}
											</span>
										</button>
									))
								)}
							</div>
						</div>
					)}

					<div className="flex items-center justify-end gap-2 border-t border-black/5 px-4 py-3 dark:border-white/5">
						{busy && (
							<span role="status" className="mr-auto text-xs text-on-surface-variant">
								{mode === 'tag' ? 'Saving…' : 'Linking… the sync server may be waking up.'}
							</span>
						)}
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							disabled={busy}
							className={`min-h-11 rounded-lg px-3 text-sm font-medium text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-60 ${FOCUS_RING}`}
						>
							Cancel
						</button>
						{mode === 'tag' && (
							<button
								type="button"
								onClick={submitTag}
								disabled={!tagValid || busy}
								className={`min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-on-primary hover:bg-primary/90 premium-transition disabled:opacity-60 ${FOCUS_RING}`}
							>
								Add tag
							</button>
						)}
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	)
}
