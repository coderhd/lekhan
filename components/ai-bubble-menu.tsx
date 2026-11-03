'use client'

import { useEffect, useState } from 'react'
import { Editor, useEditorState } from '@tiptap/react'
import { Bold, Italic, Underline } from 'lucide-react'

interface AIBubbleMenuProps {
	editor: Editor | null
	onOpenLekhanBot: () => void
}

const EMPTY_ACTIVE = { bold: false, italic: false, underline: false }

function sameActive (
	a: { bold: boolean; italic: boolean; underline: boolean } | null,
	b: { bold: boolean; italic: boolean; underline: boolean } | null,
) {
	if (a === b) return true
	if (!a || !b) return false
	return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline
}

export default function AIBubbleMenu({ editor, onOpenLekhanBot }: AIBubbleMenuProps) {
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

	// Active marks are read live, not from `pos`: a keyboard shortcut can
	// toggle bold while the selection coordinates (and therefore `pos`) stay
	// identical, and the buttons must still repaint (CodeRabbit #202 finding).
	const active = useEditorState({
		editor,
		selector: ({ editor: current }) => current ? {
			bold: current.isActive('bold'),
			italic: current.isActive('italic'),
			underline: current.isActive('underline'),
		} : EMPTY_ACTIVE,
		equalityFn: sameActive,
	}) ?? EMPTY_ACTIVE

	useEffect(() => {
		if (!editor) return

		const updatePosition = () => {
			const { state, view } = editor
			const { selection } = state

			if (selection.empty) {
				setPos(null)
				return
			}

			const { from, to } = selection
			const start = view.coordsAtPos(from)
			const end = view.coordsAtPos(to)
			const editorCanvas = view.dom.closest('.editor-canvas') as HTMLElement

			if (editorCanvas) {
				const canvasRect = editorCanvas.getBoundingClientRect()
				const next = {
					top: start.top - canvasRect.top - 45,
					left: Math.max(10, (start.left + end.left) / 2 - canvasRect.left - 80),
				}
				// Transactions fire on every keystroke; only publish a new
				// position when it actually moved (SIL-230 / #144).
				setPos(prev => (
					prev && prev.top === next.top && prev.left === next.left ? prev : next
				))
			}
		}

		editor.on('selectionUpdate', updatePosition)
		editor.on('transaction', updatePosition)
		return () => {
			editor.off('selectionUpdate', updatePosition)
			editor.off('transaction', updatePosition)
		}
	}, [editor])

	if (!editor || !pos) return null

	return (
		<div
			style={{ top: Math.max(0, pos.top), left: pos.left }}
			className="absolute z-50 flex items-center overflow-hidden rounded-lg border border-black/10 dark:border-white/10 bg-surface-container/90 backdrop-blur-md shadow-xl p-1 animate-in fade-in zoom-in-95"
		>
			<button
				type="button"
				onClick={() => editor.chain().focus().toggleBold().run()}
				className={`p-1.5 transition rounded-md ${active.bold ? 'bg-primary/20 text-primary' : 'hover:bg-black/5 dark:hover:bg-white/10 text-on-surface'}`}
				title="Bold"
			>
				<Bold className="h-4 w-4" />
			</button>
			<button
				type="button"
				onClick={() => editor.chain().focus().toggleItalic().run()}
				className={`p-1.5 transition rounded-md ${active.italic ? 'bg-primary/20 text-primary' : 'hover:bg-black/5 dark:hover:bg-white/10 text-on-surface'}`}
				title="Italic"
			>
				<Italic className="h-4 w-4" />
			</button>
			<button
				type="button"
				onClick={() => editor.chain().focus().toggleUnderline().run()}
				className={`p-1.5 transition rounded-md ${active.underline ? 'bg-primary/20 text-primary' : 'hover:bg-black/5 dark:hover:bg-white/10 text-on-surface'}`}
				title="Underline"
			>
				<Underline className="h-4 w-4" />
			</button>

			<div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-1" />

			<button
				type="button"
				onClick={onOpenLekhanBot}
				className="flex items-center gap-1.5 p-1.5 px-2.5 text-xs font-semibold hover:bg-primary/10 text-primary transition rounded-md"
				title="Ask Lekhan Bot (⌘L)"
			>
				<span className="material-symbols-outlined text-sm">auto_awesome</span>
				<span>AI</span>
			</button>
		</div>
	)
}
