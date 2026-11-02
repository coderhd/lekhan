'use client'

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import type { WikilinkSuggestionItem } from '@/lib/wikilink'

export interface WikilinkListProps {
	items: WikilinkSuggestionItem[]
	command: (item: WikilinkSuggestionItem) => void
}

export interface WikilinkListRef {
	onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

/**
 * Popup list for the `[[` page-link autocomplete (SIL-159). Visual twins of
 * MentionList (same surface/outline/primary-container tokens); adds the
 * Obsidian-style "Create"<query>" page" affordance (#142 empty state) and a
 * non-interactive hint when the workspace has no pages yet.
 */
const WikilinkList = forwardRef<WikilinkListRef, WikilinkListProps>(({ items, command }, ref) => {
	const [selectedIndex, setSelectedIndex] = useState(0)
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setSelectedIndex(0)
	}, [items])

	// Scroll selected item into view
	useEffect(() => {
		const container = containerRef.current
		if (!container) return
		const selected = container.querySelector(`[data-index="${selectedIndex}"]`)
		if (selected) {
			selected.scrollIntoView({ block: 'nearest' })
		}
	}, [selectedIndex])

	useImperativeHandle(ref, () => ({
		onKeyDown: ({ event }: { event: KeyboardEvent }) => {
			if (items.length === 0) return false
			if (event.key === 'ArrowUp') {
				setSelectedIndex((selectedIndex + items.length - 1) % items.length)
				return true
			}
			if (event.key === 'ArrowDown') {
				setSelectedIndex((selectedIndex + 1) % items.length)
				return true
			}
			if (event.key === 'Enter' || event.key === 'Tab') {
				const item = items[selectedIndex]
				if (item && item.kind !== 'hint') {
					command(item)
					return true
				}
				// Hint rows are non-interactive; swallow Enter while the popup is
				// open so it doesn't insert a stray newline behind the popup.
				return item ? true : false
			}
			return false
		},
	}))

	if (items.length === 0) {
		return (
			<div className="bg-surface-container border border-outline/20 rounded-lg p-3 text-xs text-on-surface-variant shadow-lg backdrop-blur-md">
				No pages found
			</div>
		)
	}

	return (
		<div
			ref={containerRef}
			className="bg-surface-container/95 dark:bg-surface-container border border-outline/20 rounded-xl p-1.5 shadow-2xl backdrop-blur-md w-64 max-h-60 overflow-y-auto space-y-1 z-50"
		>
			<div className="px-2 py-1 text-[10px] font-label-sm uppercase tracking-wider text-on-surface-variant/70">
				Pages
			</div>
			{items.map((item, index) => {
				if (item.kind === 'hint') {
					return (
						<div
							key={item.id}
							data-index={index}
							className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-on-surface-variant/70"
						>
							<FileText className="h-3.5 w-3.5 shrink-0" />
							<span>Type a name to create a page</span>
						</div>
					)
				}

				const isCreate = item.kind === 'create'
				const Icon = isCreate ? Plus : FileText

				return (
					<button
						key={item.id}
						type="button"
						data-index={index}
						data-testid={isCreate ? 'wikilink-create-item' : 'wikilink-page-item'}
						onClick={() => command(item)}
						className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
							index === selectedIndex
								? 'bg-primary-container text-on-primary-container font-medium'
								: 'text-on-surface hover:bg-surface-variant/50'
						}`}
					>
						<Icon
							className={`h-3.5 w-3.5 shrink-0 ${isCreate ? 'text-primary' : 'text-on-surface-variant/60'}`}
						/>
						<div className="flex flex-col min-w-0">
							<span className="truncate font-medium">
								{isCreate ? `Create “${item.title}” page` : item.title}
							</span>
							{isCreate && (
								<span className="text-[10px] text-on-surface-variant/70 truncate">
									New page linked here
								</span>
							)}
						</div>
					</button>
				)
			})}
		</div>
	)
})

WikilinkList.displayName = 'WikilinkList'

export default WikilinkList
