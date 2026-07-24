'use client'

import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { User } from 'lucide-react'

export interface MentionItem {
	id: string
	name: string
	email?: string
	avatarUrl?: string
}

export interface MentionListProps {
	items: MentionItem[]
	command: (item: { id: string; label: string }) => void
}

export interface MentionListRef {
	onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(({ items, command }, ref) => {
	const [selectedIndex, setSelectedIndex] = useState(0)

	useEffect(() => {
		setSelectedIndex(0)
	}, [items])

	const selectItem = (index: number) => {
		const item = items[index]
		if (item) {
			command({ id: item.id, label: item.name })
		}
	}

	const upHandler = () => {
		setSelectedIndex((selectedIndex + items.length - 1) % items.length)
	}

	const downHandler = () => {
		setSelectedIndex((selectedIndex + 1) % items.length)
	}

	const enterHandler = () => {
		selectItem(selectedIndex)
	}

	useImperativeHandle(ref, () => ({
		onKeyDown: ({ event }: { event: KeyboardEvent }) => {
			if (event.key === 'ArrowUp') {
				upHandler()
				return true
			}

			if (event.key === 'ArrowDown') {
				downHandler()
				return true
			}

			if (event.key === 'Enter' || event.key === 'Tab') {
				enterHandler()
				return true
			}

			return false
		},
	}))

	if (!items || items.length === 0) {
		return (
			<div className="bg-surface-container border border-outline/20 rounded-lg p-3 text-xs text-on-surface-variant shadow-lg backdrop-blur-md">
				No collaborators found
			</div>
		)
	}

	return (
		<div className="bg-surface-container/95 dark:bg-surface-container border border-outline/20 rounded-xl p-1.5 shadow-2xl backdrop-blur-md w-64 max-h-60 overflow-y-auto space-y-1 z-50">
			<div className="px-2 py-1 text-[10px] font-label-sm uppercase tracking-wider text-on-surface-variant/70">
				Collaborators
			</div>
			{items.map((item, index) => (
				<button
					key={item.id}
					type="button"
					onClick={() => selectItem(index)}
					className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
						index === selectedIndex
							? 'bg-primary-container text-on-primary-container font-medium'
							: 'text-on-surface hover:bg-surface-variant/50'
					}`}
				>
					<div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
						{item.name ? item.name.charAt(0).toUpperCase() : <User className="w-3 h-3" />}
					</div>
					<div className="flex flex-col truncate">
						<span className="truncate font-medium">{item.name}</span>
						{item.email && <span className="text-[10px] text-on-surface-variant/70 truncate">{item.email}</span>}
					</div>
				</button>
			))}
		</div>
	)
})

MentionList.displayName = 'MentionList'

export default MentionList
