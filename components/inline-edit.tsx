import React, { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface InlineEditProps {
	initialValue: string
	onSave: (newValue: string) => Promise<void> | void
	isEditingProp?: boolean
	onCancelEdit?: () => void
	textClassName?: string
	inputClassName?: string
	containerClassName?: string
	iconClassName?: string
}

export function InlineEdit({
	initialValue,
	onSave,
	isEditingProp,
	onCancelEdit,
	textClassName,
	inputClassName,
	containerClassName,
	iconClassName
}: InlineEditProps) {
	const [isEditing, setIsEditing] = useState(false)
	const [value, setValue] = useState(initialValue)
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setValue(initialValue)
	}, [initialValue])

	useEffect(() => {
		if (isEditingProp !== undefined) {
			setIsEditing(isEditingProp)
		}
	}, [isEditingProp])

	const cancelEdit = () => {
		setValue(initialValue)
		setIsEditing(false)
		if (onCancelEdit) onCancelEdit()
	}

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				cancelEdit()
			}
		}

		if (isEditing) {
			document.addEventListener('mousedown', handleClickOutside)
		} else {
			document.removeEventListener('mousedown', handleClickOutside)
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
		}
	}, [isEditing, initialValue, onCancelEdit])

	const handleSave = async (e?: React.MouseEvent) => {
		if (e) {
			e.preventDefault()
			e.stopPropagation()
		}
		const newValue = value.trim() || 'Untitled Document'
		setValue(newValue)
		setIsEditing(false)
		if (onCancelEdit) onCancelEdit() // Clear any external editing state

		try {
			await onSave(newValue)
		} catch (err) {
			console.error(err)
			setValue(initialValue) // Revert on failure
		}
	}

	return (
		<div 
			className={cn("flex items-center gap-1 group", containerClassName)} 
			ref={containerRef}
			onClick={(e) => {
				// Prevent clicking inside from triggering card navigation
				if (isEditing) e.stopPropagation()
			}}
		>
			{isEditing ? (
				<>
					<input
						type='text'
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') handleSave()
							if (e.key === 'Escape') cancelEdit()
						}}
						autoFocus
						className={cn('bg-black/5 dark:bg-white/5 border-none focus:outline-none focus:ring-2 focus:ring-primary-container/50 font-bold text-lg text-primary-container py-1 w-24 sm:w-32 lg:w-48 rounded px-2 transition-colors cursor-text', inputClassName)}
						placeholder='Untitled Document'
					/>
					<div className="flex items-center gap-1 shrink-0">
						<button onClick={handleSave} className="text-primary hover:bg-primary/10 rounded-full premium-transition flex items-center justify-center p-1">
							<span className={cn("material-symbols-outlined text-[18px]", iconClassName)}>check</span>
						</button>
						<button 
							onClick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								cancelEdit()
							}} 
							className="text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/10 rounded-full premium-transition flex items-center justify-center p-1"
						>
							<span className={cn("material-symbols-outlined text-[18px]", iconClassName)}>close</span>
						</button>
					</div>
				</>
			) : (
				<>
					<span 
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
							setIsEditing(true)
						}}
						className={cn('font-bold text-lg text-primary-container py-1 px-2 w-24 sm:w-32 lg:w-48 hover:bg-black/5 dark:hover:bg-white/5 rounded cursor-pointer truncate transition-colors', textClassName)}
					>
						{value}
					</span>
					<button 
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
							setIsEditing(true)
						}}
						className="text-on-surface-variant hover:text-primary-container opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center p-1 shrink-0"
					>
						<span className={cn("material-symbols-outlined text-[18px]", iconClassName)}>edit</span>
					</button>
				</>
			)}
		</div>
	)
}
