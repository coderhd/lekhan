'use client'

import { Editor } from '@tiptap/react'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { GripVertical } from 'lucide-react'

export function DragContextMenu({ editor }: { editor: Editor | null }) {
	if (!editor) return null

	return (
		<DragHandle editor={editor}>
			<button
				type="button"
				className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors"
				title="Drag to move block"
			>
				<GripVertical className="w-4 h-4" />
			</button>
		</DragHandle>
	)
}
