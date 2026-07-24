'use client'

import { useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { LEKHAN_BOT_ACTIONS } from '@/lib/ai-constants'

interface AIDiffPreviewProps {
	editor: any
	actionId: string
	originalText: string
	resultText: string
	position: { x: number, y: number }
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

// 'translate' and 'transliterate' aren't in LEKHAN_BOT_ACTIONS (they're
// picker-driven from the bar, not flat single-click presets), so they'd
// otherwise fall through to the generic 'both' default below. Both/either
// button still works either way — this just decides which one is visually
// emphasized as the primary action.
const DEFAULT_INSERT_OVERRIDES: Record<string, 'accept' | 'below' | 'both'> = {
	translate: 'below', // both original and translation are usually wanted
	transliterate: 'accept', // script conversion replaces the source script
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
	const actionDef = LEKHAN_BOT_ACTIONS.find(a => a.id === actionId)
	const defaultInsert = actionDef?.defaultInsert || DEFAULT_INSERT_OVERRIDES[actionId] || 'both'

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

	const handleAccept = () => {
		const { doc } = editor.state
		const fullText = doc.textContent
		const idx = fullText.indexOf(originalText)
		if (idx !== -1) {
			editor.chain().focus()
				.setTextSelection({ from: idx + 1, to: idx + 1 + originalText.length })
				.insertContent(resultText).run()
		} else {
			editor.chain().focus().insertContent(resultText).run()
		}
		onClose()
	}

	const handleInsertBelow = () => {
		const { to } = editor.state.selection
		editor.chain().focus().setTextSelection(to)
			.insertContent(`\n\n${resultText}`).run()
		onClose()
	}

	const handleCopy = () => {
		navigator.clipboard.writeText(resultText)
		toast.success('Copied to clipboard')
		onClose()
	}

	const cardWidth = 360
	const clampedX = Math.min(position.x, window.innerWidth - cardWidth - 16)
	const clampedY = Math.min(position.y, window.innerHeight - 300)

	return createPortal(
		<div
			ref={cardRef}
			className="fixed z-[9998] w-[360px] bg-surface-container border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
			style={{ left: clampedX, top: clampedY }}
		>
			<div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5">
				<div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
					<span className="material-symbols-outlined text-primary text-sm">auto_awesome</span>
					{actionLabel}
				</div>
				<button onClick={onClose} className="rounded-lg p-1 hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant transition">
					<span className="material-symbols-outlined text-sm">close</span>
				</button>
			</div>

			<div className="px-4 py-3 space-y-3 max-h-48 overflow-y-auto touch-scroll-container">
				{originalText && (
					<div>
						<div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 mb-1">Original</div>
						<div className="text-xs text-on-surface-variant bg-black/5 dark:bg-white/5 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed max-h-20 overflow-y-auto">
							{originalText}
						</div>
					</div>
				)}
				<div>
					<div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 mb-1">Result</div>
					<div className="text-xs text-on-surface bg-primary-container/10 border border-primary-container/20 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed max-h-20 overflow-y-auto">
						{resultText}
					</div>
				</div>
			</div>

			<div className="flex items-center gap-2 px-4 py-3 border-t border-black/5 dark:border-white/5">
				<button onClick={handleAccept} className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
					defaultInsert === 'accept' || defaultInsert === 'both'
						? 'bg-primary-container text-on-primary-container hover:brightness-110'
						: 'bg-black/5 dark:bg-white/5 text-on-surface hover:bg-black/10 dark:hover:bg-white/10'
				}`}>
					<span className="material-symbols-outlined text-sm">check</span>
					Accept
				</button>
				<button onClick={handleInsertBelow} className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
					defaultInsert === 'below'
						? 'bg-primary-container text-on-primary-container hover:brightness-110'
						: 'bg-black/5 dark:bg-white/5 text-on-surface hover:bg-black/10 dark:hover:bg-white/10'
				}`}>
					<span className="material-symbols-outlined text-sm">subdirectory_arrow_right</span>
					Insert Below
				</button>
				<button onClick={handleCopy} className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs text-on-surface-variant bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-all active:scale-95">
					<span className="material-symbols-outlined text-sm">content_copy</span>
				</button>
			</div>
		</div>,
		document.body,
	)
}
