'use client'

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import type { SlashMenuItem } from '@/lib/slash-menu-extension'

interface SlashMenuComponentProps {
	items: SlashMenuItem[]
	command: (item: SlashMenuItem) => void
}

export const SlashMenuComponent = forwardRef(
	({ items, command }: SlashMenuComponentProps, ref) => {
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
				if (event.key === 'ArrowUp') {
					setSelectedIndex((selectedIndex + items.length - 1) % items.length)
					return true
				}
				if (event.key === 'ArrowDown') {
					setSelectedIndex((selectedIndex + 1) % items.length)
					return true
				}
				if (event.key === 'Enter') {
					const item = items[selectedIndex]
					if (item) command(item)
					return true
				}
				return false
			},
		}))

		if (items.length === 0) return null

		return (
			<div
				ref={containerRef}
				className="z-[9999] w-64 bg-surface-container border border-black/10 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto touch-scroll-container p-1"
			>
				{items.map((item, index) => (
					<button
						key={item.id}
						data-index={index}
						onClick={() => command(item)}
						className={`w-full flex items-center gap-3 px-3 py-2 text-xs rounded-lg transition ${
							index === selectedIndex
								? 'bg-primary-container/20 text-on-surface'
								: 'text-on-surface hover:bg-black/5 dark:hover:bg-white/5'
						}`}
					>
						<span className={`material-symbols-outlined text-base ${
							item.id === 'l' ? 'text-primary' : 'text-on-surface-variant/60'
						}`}>
							{item.icon}
						</span>
						<div className="text-left">
							<div className={item.id === 'l' ? 'font-semibold text-primary' : ''}>
								{item.label}
							</div>
							{item.description && (
								<div className="text-[10px] text-on-surface-variant/50">
									{item.description}
								</div>
							)}
						</div>
					</button>
				))}
			</div>
		)
	},
)
SlashMenuComponent.displayName = 'SlashMenuComponent'
