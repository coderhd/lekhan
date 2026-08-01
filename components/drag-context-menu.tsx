'use client'

import { Editor } from '@tiptap/react'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
	GripVertical,
	Trash2,
	Copy,
	Heading1,
	Heading2,
	Heading3,
	Pilcrow,
	List,
	ListOrdered,
	CheckSquare,
	Code2,
	Table as TableIcon,
	RemoveFormatting,
} from 'lucide-react'

export function DragContextMenu({ editor }: { editor: Editor | null }) {
	if (!editor) return null

	return (
		<DragHandle editor={editor}>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild>
					<button
						type="button"
						className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors"
						title="Drag to move, click to open menu"
					>
						<GripVertical className="w-4 h-4" />
					</button>
				</DropdownMenu.Trigger>

				<DropdownMenu.Portal>
					<DropdownMenu.Content
						className="z-[9999] min-w-[12rem] bg-surface-container rounded-xl border border-black/10 dark:border-white/10 p-1.5 shadow-xl text-xs space-y-0.5"
						sideOffset={5}
						align="start"
					>
						<DropdownMenu.Item
							onClick={() => {
								editor.chain().focus().deleteSelection().run()
							}}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-red-500 hover:bg-red-500/10 cursor-pointer outline-none transition-colors"
						>
							<Trash2 className="w-4 h-4" />
							<span>Delete</span>
						</DropdownMenu.Item>

						<DropdownMenu.Item
							onClick={() => {
								const { state } = editor
								const { selection } = state
								const node = selection.$from.node(1) || selection.$from.parent
								if (node) {
									editor.chain().focus().insertContent(node.toJSON()).run()
								}
							}}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<Copy className="w-4 h-4" />
							<span>Duplicate</span>
						</DropdownMenu.Item>

						<DropdownMenu.Separator className="h-[1px] bg-black/10 dark:bg-white/10 my-1" />

						<DropdownMenu.Label className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/60">
							Turn Into
						</DropdownMenu.Label>

						<DropdownMenu.Item
							onClick={() => editor.chain().focus().setParagraph().run()}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<Pilcrow className="w-4 h-4" />
							<span>Text / Paragraph</span>
						</DropdownMenu.Item>

						<DropdownMenu.Item
							onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<Heading1 className="w-4 h-4" />
							<span>Heading 1</span>
						</DropdownMenu.Item>

						<DropdownMenu.Item
							onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<Heading2 className="w-4 h-4" />
							<span>Heading 2</span>
						</DropdownMenu.Item>

						<DropdownMenu.Item
							onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<Heading3 className="w-4 h-4" />
							<span>Heading 3</span>
						</DropdownMenu.Item>

						<DropdownMenu.Item
							onClick={() => editor.chain().focus().toggleBulletList().run()}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<List className="w-4 h-4" />
							<span>Bullet List</span>
						</DropdownMenu.Item>

						<DropdownMenu.Item
							onClick={() => editor.chain().focus().toggleOrderedList().run()}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<ListOrdered className="w-4 h-4" />
							<span>Numbered List</span>
						</DropdownMenu.Item>

						<DropdownMenu.Item
							onClick={() => editor.chain().focus().toggleTaskList().run()}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<CheckSquare className="w-4 h-4" />
							<span>Task List</span>
						</DropdownMenu.Item>

						<DropdownMenu.Item
							onClick={() => editor.chain().focus().toggleCodeBlock().run()}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<Code2 className="w-4 h-4" />
							<span>Code Block</span>
						</DropdownMenu.Item>

						<DropdownMenu.Item
							onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<TableIcon className="w-4 h-4" />
							<span>Table</span>
						</DropdownMenu.Item>

						<DropdownMenu.Separator className="h-[1px] bg-black/10 dark:bg-white/10 my-1" />

						<DropdownMenu.Item
							onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
							className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none transition-colors"
						>
							<RemoveFormatting className="w-4 h-4" />
							<span>Clear Formatting</span>
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		</DragHandle>
	)
}
