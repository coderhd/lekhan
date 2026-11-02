'use client'

import { useId, useRef } from 'react'
import { Search, X } from 'lucide-react'
import {
	isGraphFilterActive,
	type GraphFilterAction,
	type GraphFilterState,
} from '@/lib/graph-view/filters'
import type { GraphTagFacet } from '@/lib/graph-view/types'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2'

export interface GraphFiltersProps {
	state: GraphFilterState
	facets: GraphTagFacet[]
	visiblePages: number
	totalPages: number
	dispatch: (action: GraphFilterAction) => void
}

/**
 * Graph filter bar: a labelled title search plus native checkbox tag-facet
 * chips. Multi-select facets use OR within the group; the title and facets
 * combine with AND (see `filterGraphData`). The result count is a polite live
 * region so keyboard and screen-reader users hear filters take effect.
 */
export default function GraphFilters ({
	state,
	facets,
	visiblePages,
	totalPages,
	dispatch,
}: GraphFiltersProps) {
	const titleId = useId()
	const titleInputRef = useRef<HTMLInputElement>(null)
	const active = isGraphFilterActive(state)
	const pageNoun = totalPages === 1 ? 'page' : 'pages'

	// Clearing unmounts the button; return focus to the title input so keyboard
	// users do not fall back to <body> and restart their tab order.
	const clearFilters = () => {
		dispatch({ type: 'clear' })
		titleInputRef.current?.focus()
	}

	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-black/10 bg-surface-container-lowest p-3 dark:border-white/10">
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative min-w-[220px] flex-1">
					<label htmlFor={titleId} className="sr-only">Filter pages by title</label>
					<Search
						size={16}
						aria-hidden="true"
						className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
					/>
					<input
						id={titleId}
						ref={titleInputRef}
						type="search"
						value={state.title}
						onChange={event => dispatch({ type: 'set-title', title: event.target.value })}
						placeholder="Filter pages by title…"
						className={`min-h-11 w-full rounded-xl border border-black/10 bg-surface pl-9 pr-3 text-sm text-on-surface placeholder:text-on-surface-variant/70 dark:border-white/10 ${FOCUS_RING}`}
					/>
				</div>

				<p
					role="status"
					aria-live="polite"
					className="text-xs font-medium text-on-surface-variant"
				>
					{active ? `${visiblePages} of ${totalPages} ${pageNoun}` : `${totalPages} ${pageNoun}`}
				</p>

				{active && (
					<button
						type="button"
						onClick={clearFilters}
						className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-on-surface-variant premium-transition hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10 ${FOCUS_RING}`}
					>
						<X size={14} aria-hidden="true" />
						Clear filters
					</button>
				)}
			</div>

			{facets.length > 0 && (
				<fieldset className="flex flex-wrap items-center gap-2">
					<legend className="sr-only">Filter by tag</legend>
					{facets.map((facet, index) => {
						const id = `${titleId}-tag-${index}`
						const checked = state.tags.includes(facet.tag)
						return (
							<label
								key={facet.tag}
								htmlFor={id}
								className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm premium-transition focus-within:ring-2 focus-within:ring-primary-container focus-within:ring-offset-2 ${
									checked
										? 'border-primary-container bg-primary-container/25 text-on-surface'
										: 'border-black/10 text-on-surface-variant hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10'
								}`}
							>
								<input
									id={id}
									type="checkbox"
									checked={checked}
									onChange={() => dispatch({ type: 'toggle-tag', tag: facet.tag })}
									className="h-4 w-4 shrink-0 rounded border-black/20 accent-primary focus-visible:outline-none dark:border-white/20"
								/>
								<span className="font-medium">#{facet.tag}</span>
								<span className="text-xs text-on-surface-variant">{facet.count}</span>
							</label>
						)
					})}
				</fieldset>
			)}
		</div>
	)
}
