'use client'

import { useState, useRef, useEffect } from 'react'
import { Users, Info } from 'lucide-react'
import SyncIndicator from './sync-indicator'

interface MobileInfoPanelProps {
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

export default function MobileInfoPanel({ activeUsers, isConnected, isSynced }: MobileInfoPanelProps) {
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
		<div className="relative flex items-center lg:hidden mr-2" ref={menuRef}>
			<button
				onClick={() => setIsOpen(!isOpen)}
				className={`flex items-center justify-center h-8 w-8 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-all text-on-surface ${isOpen ? 'bg-primary/10 text-primary border-primary/30' : 'bg-surface-container-low'}`}
				title="Document Info"
			>
				<Info className="h-[18px] w-[18px]" />
			</button>

			{isOpen && (
				<div className="absolute top-full right-0 mt-2 w-64 bg-surface-container-high border border-black/10 dark:border-white/10 rounded-xl shadow-xl overflow-hidden z-50 flex flex-col p-4 animate-in fade-in zoom-in-95 duration-200 gap-4">
					<div>
						<h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Status</h3>
						<SyncIndicator isConnected={isConnected} isSynced={isSynced} />
					</div>
					
					{activeUsers.length > 0 && (
						<div>
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
			)}
		</div>
	)
}
