'use client'

import { useState, useRef, useEffect } from 'react'
import ThemeToggle from './theme-toggle'
import { Users } from 'lucide-react'
import SyncIndicator from './sync-indicator'

interface MobileHeaderMenuProps {
	isHistoryOpen: boolean
	setIsHistoryOpen: (val: boolean) => void
	isAIPanelOpen: boolean
	setIsAIPanelOpen: (val: boolean) => void
	theme: 'light' | 'dark'
	toggleTheme: () => void
	activeUsers: { name: string; color: string; id: string }[]
	isConnected: boolean
	isSynced: boolean
}

function getInitials(nameOrEmail: string) {
	if (!nameOrEmail) return '?'
	if (nameOrEmail.includes('@')) {
		return nameOrEmail.charAt(0).toUpperCase()
	}
	const parts = nameOrEmail.split(' ').filter(Boolean)
	if (parts.length > 1) {
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
	}
	return nameOrEmail.charAt(0).toUpperCase()
}

export default function MobileHeaderMenu({
	isHistoryOpen,
	setIsHistoryOpen,
	isAIPanelOpen,
	setIsAIPanelOpen,
	theme,
	toggleTheme,
	activeUsers,
	isConnected,
	isSynced,
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
				<div className="absolute top-full right-0 mt-2 w-56 bg-surface-container-high border border-black/10 dark:border-white/10 rounded-xl shadow-xl overflow-hidden z-50 flex flex-col py-1 animate-in fade-in zoom-in-95 duration-200">
					<div className="px-4 py-3 flex flex-col gap-4 border-b border-black/5 dark:border-white/5">
						<div>
							<h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Status</h3>
							<SyncIndicator isConnected={isConnected} isSynced={isSynced} />
						</div>
						
						{activeUsers.length > 0 && (
							<div className="sm:hidden">
								<h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2 flex items-center gap-1">
									<Users className="w-3 h-3" />
									Collaborators ({activeUsers.length})
								</h3>
								<div className="flex flex-wrap gap-2">
									{activeUsers.map((activeUser, idx) => (
										<div
											key={idx}
											className="w-8 h-8 rounded-full border-2 border-surface-container flex items-center justify-center text-xs font-bold text-white shadow-sm"
											style={{ backgroundColor: activeUser.color }}
											title={activeUser.name}
										>
											{getInitials(activeUser.name)}
										</div>
									))}
								</div>
							</div>
						)}
					</div>

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
