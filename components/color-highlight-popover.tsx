import React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Editor } from '@tiptap/react'

const TEXT_COLORS = [
	{ label: 'Default', value: '', icon: 'format_color_text' },
	{ label: 'Gray', value: '#9ca3af', icon: 'format_color_text' },
	{ label: 'Brown', value: '#a16207', icon: 'format_color_text' },
	{ label: 'Orange', value: '#f97316', icon: 'format_color_text' },
	{ label: 'Yellow', value: '#eab308', icon: 'format_color_text' },
	{ label: 'Green', value: '#22c55e', icon: 'format_color_text' },
	{ label: 'Blue', value: '#3b82f6', icon: 'format_color_text' },
	{ label: 'Purple', value: '#a855f7', icon: 'format_color_text' },
	{ label: 'Pink', value: '#ec4899', icon: 'format_color_text' },
	{ label: 'Red', value: '#ef4444', icon: 'format_color_text' },
]

const HIGHLIGHT_COLORS = [
	{ label: 'Default', value: '', icon: 'format_color_fill' },
	{ label: 'Gray', value: '#f3f4f6', icon: 'format_color_fill' },
	{ label: 'Brown', value: '#fef3c7', icon: 'format_color_fill' },
	{ label: 'Orange', value: '#ffedd5', icon: 'format_color_fill' },
	{ label: 'Yellow', value: '#fef9c3', icon: 'format_color_fill' },
	{ label: 'Green', value: '#dcfce7', icon: 'format_color_fill' },
	{ label: 'Blue', value: '#dbeafe', icon: 'format_color_fill' },
	{ label: 'Purple', value: '#f3e8ff', icon: 'format_color_fill' },
	{ label: 'Pink', value: '#fce7f3', icon: 'format_color_fill' },
	{ label: 'Red', value: '#fee2e2', icon: 'format_color_fill' },
]

export function ColorHighlightPopover({ editor }: { editor: Editor | null }) {
	if (!editor) return null

	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<button className="p-1 rounded transition-colors flex items-center justify-center text-on-surface hover:bg-black/5 dark:hover:bg-white/10" title="Text Color & Highlight">
					<span className="material-symbols-outlined text-[18px]">format_color_text</span>
				</button>
			</DropdownMenu.Trigger>

			<DropdownMenu.Portal>
				<DropdownMenu.Content
					className="z-[9999] min-w-[12rem] bg-surface-container rounded-xl border border-black/10 dark:border-white/10 p-2 shadow-xl"
					sideOffset={5}
				>
					<div className="text-xs font-semibold text-on-surface-variant mb-2 px-2 uppercase tracking-wider">Text Color</div>
					<div className="flex flex-col gap-0.5 mb-2">
						{TEXT_COLORS.map((color) => (
							<DropdownMenu.Item
								key={color.label}
								onClick={() => {
									if (color.value === '') {
										editor.chain().focus().unsetColor().run()
									} else {
										editor.chain().focus().setColor(color.value).run()
									}
								}}
								className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none"
							>
								<span className="material-symbols-outlined text-[16px]" style={{ color: color.value || 'inherit' }}>
									{color.icon}
								</span>
								<span>{color.label}</span>
							</DropdownMenu.Item>
						))}
					</div>

					<div className="h-px bg-black/10 dark:bg-white/10 my-2 mx-1" />

					<div className="text-xs font-semibold text-on-surface-variant mb-2 px-2 uppercase tracking-wider">Background</div>
					<div className="flex flex-col gap-0.5">
						{HIGHLIGHT_COLORS.map((color) => (
							<DropdownMenu.Item
								key={color.label}
								onClick={() => {
									if (color.value === '') {
										editor.chain().focus().unsetHighlight().run()
									} else {
										editor.chain().focus().setHighlight({ color: color.value }).run()
									}
								}}
								className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none"
							>
								<div className="w-5 h-5 rounded flex items-center justify-center border border-black/10 dark:border-white/10" style={{ backgroundColor: color.value || 'transparent' }}>
									<span className="material-symbols-outlined text-[14px]">format_color_fill</span>
								</div>
								<span>{color.label}</span>
							</DropdownMenu.Item>
						))}
					</div>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	)
}
