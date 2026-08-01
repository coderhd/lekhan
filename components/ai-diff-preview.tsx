'use client'

import { useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { LEKHAN_BOT_ACTIONS } from '@/lib/ai-constants'

interface AIDiffPreviewProps {
	editor: any
	actionId: string
	originalText: string
	resultText: string
	position: { x: number; y: number }
	onClose: () => void
}

const ACTION_LABELS: Record<string, string> = {
	'fix-grammar': 'Grammar Fix',
	'improve-flow': 'Rewrite',
	'summarize': 'Summary',
	'expand': 'Expanded',
	'make-shorter': 'Shortened',
	'translate': 'Translation',
	'transliterate': 'Transliteration',
	'custom-prompt': 'Lekhan Bot',
}

const DEFAULT_INSERT_OVERRIDES: Record<string, 'accept' | 'below' | 'both'> = {
	translate: 'below',
	transliterate: 'accept',
}

export default function AIDiffPreview({
	editor,
	actionId,
	originalText,
	resultText,
	position,
	onClose,
}: AIDiffPreviewProps) {
	const cardRef = useRef<HTMLDivElement>(null)
	const actionLabel = ACTION_LABELS[actionId] || 'Lekhan Bot'
	const actionDef = LEKHAN_BOT_ACTIONS.find((a) => a.id === actionId)
	const defaultInsert = actionDef?.defaultInsert || DEFAULT_INSERT_OVERRIDES[actionId] || 'both'

	const [coords, setCoords] = useState({ left: position.x, top: position.y })

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
				onClose()
			}
		}
		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [onClose])

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [onClose])

	useEffect(() => {
		if (cardRef.current) {
			const cardRect = cardRef.current.getBoundingClientRect()
			const cardWidth = cardRect.width || 380
			const cardHeight = cardRect.height || 320

			// Bottom threshold accounting for docking BotBar (~110px from bottom)
			const botBarTopThreshold = window.innerHeight - 110

			const finalX = Math.max(16, Math.min(position.x, window.innerWidth - cardWidth - 16))
			let finalY = position.y

			// If position.y + cardHeight overlaps the bot bar or overflows bottom viewport
			if (position.y + cardHeight > botBarTopThreshold) {
				const flippedY = position.y - cardHeight - 24
				if (flippedY >= 16) {
					finalY = flippedY
				} else {
					// Fit nicely above the bot bar
					finalY = Math.max(16, botBarTopThreshold - cardHeight - 12)
				}
			} else {
				finalY = Math.max(16, position.y)
			}

			setCoords({ left: finalX, top: finalY })
		}
	}, [position.x, position.y, originalText, resultText])

	const handleAccept = () => {
		const { doc } = editor.state
		const fullText = doc.textContent
		const idx = fullText.indexOf(originalText)
		if (idx !== -1) {
			editor
				.chain()
				.focus()
				.setTextSelection({ from: idx + 1, to: idx + 1 + originalText.length })
				.insertContent(resultText)
				.run()
		} else {
			editor.chain().focus().insertContent(resultText).run()
		}
		onClose()
	}

	const handleInsertBelow = () => {
		const { to } = editor.state.selection
		editor
			.chain()
			.focus()
			.setTextSelection(to)
			.insertContent(`\n\n${resultText}`)
			.run()
		onClose()
	}

	const handleCopy = () => {
		navigator.clipboard.writeText(resultText)
		toast.success('Copied to clipboard')
		onClose()
	}

	return createPortal(
		<div
			ref={cardRef}
			className="fixed z-[9999] w-[calc(100vw-32px)] sm:w-[380px] max-h-[80vh] bg-surface-container border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
			style={{ left: coords.left, top: coords.top }}
		>
			<div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5 shrink-0">
				<div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
					<span className="material-symbols-outlined text-primary text-sm">auto_awesome</span>
					{actionLabel}
				</div>
				<button onClick={onClose} className="rounded-lg p-1 hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant transition">
					<span className="material-symbols-outlined text-sm">close</span>
				</button>
			</div>

			<div className="px-4 py-3 space-y-3 overflow-y-auto touch-scroll-container flex-1">
				{originalText && (
					<div>
						<div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 mb-1">Original</div>
						<div className="text-xs text-on-surface-variant bg-black/5 dark:bg-white/5 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed max-h-28 overflow-y-auto">
							{originalText}
						</div>
					</div>
				)}
				<div>
					<div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 mb-1">Result</div>
					<div className="text-xs text-on-surface bg-primary-container/10 border border-primary-container/20 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
						{resultText}
					</div>
				</div>
			</div>

			<div className="flex items-center gap-2 px-4 py-3 border-t border-black/5 dark:border-white/5 shrink-0 bg-surface-container">
				<button
					onClick={handleAccept}
					className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 ${defaultInsert === 'accept' || defaultInsert === 'both'
							? 'bg-primary-container text-on-primary-container hover:brightness-110 shadow-sm'
							: 'bg-black/5 dark:bg-white/5 text-on-surface hover:bg-black/10 dark:hover:bg-white/10'
						}`}
				>
					<span className="material-symbols-outlined text-sm">check</span>
					Accept
				</button>
				<button
					onClick={handleInsertBelow}
					className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 ${defaultInsert === 'below'
							? 'bg-primary-container text-on-primary-container hover:brightness-110 shadow-sm'
							: 'bg-black/5 dark:bg-white/5 text-on-surface hover:bg-black/10 dark:hover:bg-white/10'
						}`}
				>
					<span className="material-symbols-outlined text-sm">subdirectory_arrow_right</span>
					Insert Below
				</button>
				<button
					onClick={handleCopy}
					className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs text-on-surface-variant bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-all active:scale-95 ml-auto"
					title="Copy result"
				>
					<span className="material-symbols-outlined text-sm">content_copy</span>
				</button>
			</div>
		</div>,
		document.body,
	)
}
