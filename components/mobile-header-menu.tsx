'use client'

import { useState, useRef, useEffect } from 'react'
import ThemeToggle from './theme-toggle'

interface MobileHeaderMenuProps {
	isHistoryOpen: boolean
	setIsHistoryOpen: (val: boolean) => void
	isAIPanelOpen: boolean
	setIsAIPanelOpen: (val: boolean) => void
	theme: 'light' | 'dark'
	toggleTheme: () => void
}

export default function MobileHeaderMenu({
	isHistoryOpen,
	setIsHistoryOpen,
	isAIPanelOpen,
	setIsAIPanelOpen,
	theme,
	toggleTheme,
}: MobileHeaderMenuProps) {
	const [isOpen, setIsOpen] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setIsOpen(false)
			}
		}
		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside)
		}
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [isOpen])

	return (
		<div className="relative flex items-center md:hidden" ref={menuRef}>
			<button
				onClick={() => setIsOpen(!isOpen)}
				className={`flex items-center justify-center h-8 w-8 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-all text-on-surface ${isOpen ? 'bg-primary/10 text-primary border-primary/30' : 'bg-surface-container-low'}`}
				title="More options"
			>
				<span className="material-symbols-outlined text-lg">more_vert</span>
			</button>

			{isOpen && (
				<div className="absolute top-full right-0 mt-2 w-48 bg-surface-container-high border border-black/10 dark:border-white/10 rounded-xl shadow-xl overflow-hidden z-50 flex flex-col py-1 animate-in fade-in zoom-in-95 duration-200">
					<button
						onClick={() => {
							setIsHistoryOpen(!isHistoryOpen)
							setIsAIPanelOpen(false)
							setIsOpen(false)
						}}
						className={`flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${isHistoryOpen ? 'text-primary' : 'text-on-surface'}`}
					>
						<span className="material-symbols-outlined text-[20px]">history</span>
						Version History
					</button>

					<button
						onClick={() => {
							setIsAIPanelOpen(!isAIPanelOpen)
							setIsHistoryOpen(false)
							setIsOpen(false)
						}}
						className={`flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${isAIPanelOpen ? 'text-primary' : 'text-on-surface'}`}
					>
						<span className="material-symbols-outlined text-[20px]">auto_awesome</span>
						AI Companion
					</button>
                    
					<div className="border-t border-black/5 dark:border-white/5 my-1" />
                    
					<div className="flex items-center justify-between px-4 py-2">
						<span className="text-sm font-medium text-on-surface">Theme</span>
						<ThemeToggle />
					</div>
				</div>
			)}
		</div>
	)
}
