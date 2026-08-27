import React from 'react'
import { Sparkles, AlignLeft, Languages, CheckCircle, ArrowRight } from 'lucide-react'

export interface AIActionsMenuProps {
	isOpen: boolean
	onAction: (actionType: 'rewrite' | 'summarize' | 'translate' | 'grammar' | 'continue', payload?: any) => void
	onClose: () => void
	position?: { top: number; left: number }
}

export function AIActionsMenu({ isOpen, onAction, onClose, position }: AIActionsMenuProps) {
	if (!isOpen) return null

	const actions = [
		{ id: 'rewrite', label: 'Rewrite & Polish', icon: Sparkles },
		{ id: 'summarize', label: 'Summarize', icon: AlignLeft },
		{ id: 'translate', label: 'Translate', icon: Languages },
		{ id: 'grammar', label: 'Fix Grammar', icon: CheckCircle },
		{ id: 'continue', label: 'Continue Writing', icon: ArrowRight },
	] as const

	const style = position ? { top: position.top, left: position.left } : {}

	return (
		<div 
			className="absolute z-50 flex items-center p-1 bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-700 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
			style={style}
		>
			{actions.map((action) => (
				<button
					key={action.id}
					onClick={() => {
						onAction(action.id)
						onClose()
					}}
					className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors whitespace-nowrap"
				>
					<action.icon className="w-4 h-4 text-purple-500" />
					{action.label}
				</button>
			))}
		</div>
	)
}
