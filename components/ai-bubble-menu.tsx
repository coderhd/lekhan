'use client'

import { BubbleMenu } from '@tiptap/react'
import { Bold, Italic, Underline } from 'lucide-react'

interface AIBubbleMenuProps {
	editor: any
	onOpenLekhanBot: () => void
}

export default function AIBubbleMenu({ editor, onOpenLekhanBot }: AIBubbleMenuProps) {
	if (!editor) return null

	return (
		<BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="flex overflow-hidden rounded-lg border border-border bg-card/80 backdrop-blur-md shadow-xl p-1 z-50">
			<button
				onClick={() => editor.chain().focus().toggleBold().run()}
				className={`p-2 transition rounded-md ${editor.isActive('bold') ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
			>
				<Bold className="h-4 w-4" />
			</button>
			<button
				onClick={() => editor.chain().focus().toggleItalic().run()}
				className={`p-2 transition rounded-md ${editor.isActive('italic') ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
			>
				<Italic className="h-4 w-4" />
			</button>
			<button
				onClick={() => editor.chain().focus().toggleUnderline().run()}
				className={`p-2 transition rounded-md ${editor.isActive('underline') ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
			>
				<Underline className="h-4 w-4" />
			</button>

			<div className="w-px bg-border mx-1 my-1" />

			<button
				onClick={onOpenLekhanBot}
				className="flex items-center gap-1.5 p-2 px-3 text-xs font-semibold hover:bg-primary/10 text-primary transition rounded-md"
				title="Lekhan Bot (⌘L)"
			>
				<span className="material-symbols-outlined text-sm">auto_awesome</span>
				<span>AI</span>
			</button>
		</BubbleMenu>
	)
}
