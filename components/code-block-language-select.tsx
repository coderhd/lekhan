'use client'

import { useEffect, useState } from 'react'
import { Editor } from '@tiptap/react'
import { Code2 } from 'lucide-react'

const LANGUAGES = [
	{ label: 'Auto / Plain Text', value: '' },
	{ label: 'JavaScript', value: 'javascript' },
	{ label: 'TypeScript', value: 'typescript' },
	{ label: 'Python', value: 'python' },
	{ label: 'HTML', value: 'html' },
	{ label: 'CSS', value: 'css' },
	{ label: 'JSON', value: 'json' },
	{ label: 'Bash / Shell', value: 'bash' },
	{ label: 'SQL', value: 'sql' },
	{ label: 'Markdown', value: 'markdown' },
	{ label: 'C++', value: 'cpp' },
	{ label: 'Java', value: 'java' },
	{ label: 'Rust', value: 'rust' },
	{ label: 'Go', value: 'go' },
	{ label: 'PHP', value: 'php' },
	{ label: 'Ruby', value: 'ruby' },
]

interface CodeBlockLanguageSelectProps {
	editor: Editor | null
}

export function CodeBlockLanguageSelect({ editor }: CodeBlockLanguageSelectProps) {
	const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

	useEffect(() => {
		if (!editor) return

		const updatePosition = () => {
			if (!editor.isActive('codeBlock')) {
				setPos(null)
				return
			}

			const { selection } = editor.state
			const { view } = editor

			let preElement: HTMLElement | null = null
			try {
				const anchorNode = view.domAtPos(selection.$anchor.pos).node
				preElement = (anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement)?.closest('pre') || null
			} catch {
				// Fallback if domAtPos fails
			}

			if (!preElement) {
				preElement = (view.dom.querySelector('pre.ProseMirror-selectednode') || view.dom.querySelector('pre:focus-within')) as HTMLElement | null
			}

			if (!preElement) {
				setPos(null)
				return
			}

			const editorCanvas = view.dom.closest('.editor-canvas') as HTMLElement
			if (!editorCanvas) return

			const preRect = preElement.getBoundingClientRect()
			const canvasRect = editorCanvas.getBoundingClientRect()

			setPos({
				top: preRect.top - canvasRect.top + 6,
				right: canvasRect.right - preRect.right + 10,
			})
		}

		updatePosition()

		editor.on('selectionUpdate', updatePosition)
		editor.on('transaction', updatePosition)
		window.addEventListener('resize', updatePosition)

		const scrollContainer = editor.view.dom.closest('main') || window
		scrollContainer.addEventListener('scroll', updatePosition, { passive: true })

		return () => {
			editor.off('selectionUpdate', updatePosition)
			editor.off('transaction', updatePosition)
			window.removeEventListener('resize', updatePosition)
			scrollContainer.removeEventListener('scroll', updatePosition)
		}
	}, [editor])

	if (!editor || !editor.isActive('codeBlock') || !pos) {
		return null
	}

	const currentLanguage = editor.getAttributes('codeBlock').language || ''

	return (
		<div
			style={{ top: pos.top, right: pos.right }}
			className="absolute z-20 flex items-center gap-1.5 px-2 py-1 bg-surface-container/95 dark:bg-surface-container-high/95 border border-black/10 dark:border-white/15 rounded-md shadow-md text-xs backdrop-blur-sm transition-all duration-150 animate-in fade-in zoom-in-95"
		>
			<Code2 className="w-3.5 h-3.5 text-primary opacity-80" />
			<select
				value={currentLanguage}
				onChange={(e) => {
					editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value }).run()
				}}
				className="bg-transparent text-on-surface font-medium border-none py-0.5 pl-0.5 pr-1 focus:outline-none cursor-pointer text-xs"
			>
				{LANGUAGES.map((lang) => (
					<option key={lang.value} value={lang.value} className="bg-surface-container text-on-surface">
						{lang.label}
					</option>
				))}
			</select>
		</div>
	)
}

