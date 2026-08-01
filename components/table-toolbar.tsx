'use client'

import { Editor } from '@tiptap/react'
import {
	Table as TableIcon,
	Rows3,
	Columns3,
	Trash2,
	Combine,
	Split,
	Heading1,
	Heading2,
	Plus,
	Minus,
} from 'lucide-react'

interface TableToolbarProps {
	editor: Editor | null
}

export function TableToolbar({ editor }: TableToolbarProps) {
	if (!editor || !editor.isActive('table')) {
		return null
	}

	return (
		<div className="flex items-center gap-1 p-1 bg-surface-container border border-black/10 dark:border-white/10 rounded-xl shadow-lg z-30 text-xs overflow-x-auto max-w-full">
			<span className="flex items-center gap-1 font-semibold px-2 text-on-surface-variant">
				<TableIcon className="w-3.5 h-3.5" /> Table
			</span>
			<div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1" />

			{/* Column controls */}
			<button
				type="button"
				onClick={() => editor.chain().focus().addColumnBefore().run()}
				className="flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-on-surface transition-colors"
				title="Add column before"
			>
				<Columns3 className="w-3.5 h-3.5" />
				<Plus className="w-2.5 h-2.5" />
			</button>

			<button
				type="button"
				onClick={() => editor.chain().focus().addColumnAfter().run()}
				className="flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-on-surface transition-colors"
				title="Add column after"
			>
				<Columns3 className="w-3.5 h-3.5 text-blue-500" />
				<Plus className="w-2.5 h-2.5" />
			</button>

			<button
				type="button"
				onClick={() => editor.chain().focus().deleteColumn().run()}
				className="flex items-center gap-1 px-2 py-1 rounded hover:bg-red-500/10 text-red-500 transition-colors"
				title="Delete column"
			>
				<Columns3 className="w-3.5 h-3.5" />
				<Minus className="w-2.5 h-2.5" />
			</button>

			<div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1" />

			{/* Row controls */}
			<button
				type="button"
				onClick={() => editor.chain().focus().addRowBefore().run()}
				className="flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-on-surface transition-colors"
				title="Add row before"
			>
				<Rows3 className="w-3.5 h-3.5" />
				<Plus className="w-2.5 h-2.5" />
			</button>

			<button
				type="button"
				onClick={() => editor.chain().focus().addRowAfter().run()}
				className="flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-on-surface transition-colors"
				title="Add row after"
			>
				<Rows3 className="w-3.5 h-3.5 text-blue-500" />
				<Plus className="w-2.5 h-2.5" />
			</button>

			<button
				type="button"
				onClick={() => editor.chain().focus().deleteRow().run()}
				className="flex items-center gap-1 px-2 py-1 rounded hover:bg-red-500/10 text-red-500 transition-colors"
				title="Delete row"
			>
				<Rows3 className="w-3.5 h-3.5" />
				<Minus className="w-2.5 h-2.5" />
			</button>

			<div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1" />

			{/* Cell controls */}
			<button
				type="button"
				onClick={() => editor.chain().focus().mergeCells().run()}
				className="flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-on-surface transition-colors"
				title="Merge cells"
			>
				<Combine className="w-3.5 h-3.5" />
				<span>Merge</span>
			</button>

			<button
				type="button"
				onClick={() => editor.chain().focus().splitCell().run()}
				className="flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-on-surface transition-colors"
				title="Split cell"
			>
				<Split className="w-3.5 h-3.5" />
				<span>Split</span>
			</button>

			<div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1" />

			{/* Header controls */}
			<button
				type="button"
				onClick={() => editor.chain().focus().toggleHeaderRow().run()}
				className="flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-on-surface transition-colors"
				title="Toggle header row"
			>
				<Heading1 className="w-3.5 h-3.5" />
				<span>Header Row</span>
			</button>

			<button
				type="button"
				onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
				className="flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-on-surface transition-colors"
				title="Toggle header column"
			>
				<Heading2 className="w-3.5 h-3.5" />
				<span>Header Col</span>
			</button>

			<div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1" />

			{/* Delete table */}
			<button
				type="button"
				onClick={() => editor.chain().focus().deleteTable().run()}
				className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors"
				title="Delete table"
			>
				<Trash2 className="w-3.5 h-3.5" />
				<span>Delete</span>
			</button>
		</div>
	)
}
