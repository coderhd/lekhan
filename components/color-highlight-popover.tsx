import { useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Editor } from '@tiptap/react'
import { useTheme } from 'next-themes'

const COLORS = [
	{ label: 'Default', id: '', text: { light: '', dark: '' }, highlight: { light: '', dark: '' } },
	{ label: 'Gray', id: 'gray', text: { light: '#9ca3af', dark: '#d1d5db' }, highlight: { light: '#f3f4f6', dark: '#374151' } },
	{ label: 'Brown', id: 'brown', text: { light: '#a16207', dark: '#fcd34d' }, highlight: { light: '#fef3c7', dark: '#78350f' } },
	{ label: 'Orange', id: 'orange', text: { light: '#f97316', dark: '#fdba74' }, highlight: { light: '#ffedd5', dark: '#9a3412' } },
	{ label: 'Yellow', id: 'yellow', text: { light: '#eab308', dark: '#fef08a' }, highlight: { light: '#fef9c3', dark: '#854d0e' } },
	{ label: 'Green', id: 'green', text: { light: '#22c55e', dark: '#86efac' }, highlight: { light: '#dcfce7', dark: '#14532d' } },
	{ label: 'Blue', id: 'blue', text: { light: '#3b82f6', dark: '#93c5fd' }, highlight: { light: '#dbeafe', dark: '#1e3a8a' } },
	{ label: 'Purple', id: 'purple', text: { light: '#a855f7', dark: '#d8b4fe' }, highlight: { light: '#f3e8ff', dark: '#581c87' } },
	{ label: 'Pink', id: 'pink', text: { light: '#ec4899', dark: '#f9a8d4' }, highlight: { light: '#fce7f3', dark: '#831843' } },
	{ label: 'Red', id: 'red', text: { light: '#ef4444', dark: '#fca5a5' }, highlight: { light: '#fee2e2', dark: '#7f1d1d' } },
]

export function ColorHighlightPopover({ editor }: { editor: Editor | null }) {
	const { resolvedTheme } = useTheme()
	const [mounted, setMounted] = useState(false)

	useEffect(() => {
		setMounted(true)
	}, [])

	if (!editor) return null

	return (
		<>
			<style>{`
				:root {
					${COLORS.filter(c => c.id).map(c => `--text-${c.id}: ${c.text.light}; --highlight-${c.id}: ${c.highlight.light};`).join('\n\t\t\t\t\t')}
				}
				.dark {
					${COLORS.filter(c => c.id).map(c => `--text-${c.id}: ${c.text.dark}; --highlight-${c.id}: ${c.highlight.dark};`).join('\n\t\t\t\t\t')}
				}
			`}</style>

			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild>
					<button className="p-1 rounded transition-colors flex items-center justify-center text-on-surface hover:bg-black/5 dark:hover:bg-white/10" title="Text Color & Highlight">
						<span className="material-symbols-outlined text-[18px]">format_color_text</span>
					</button>
				</DropdownMenu.Trigger>

				<DropdownMenu.Portal>
					<DropdownMenu.Content
						className="z-[9999] min-w-[12rem] max-h-[70vh] touch-scroll-container bg-surface-container rounded-xl border border-black/10 dark:border-white/10 p-2 shadow-xl"
						sideOffset={5}
					>
						<div className="text-xs font-semibold text-on-surface-variant mb-2 px-2 uppercase tracking-wider">Text Color</div>
						<div className="flex flex-col gap-0.5 mb-2">
							{COLORS.map((color) => {
								const value = color.id ? `var(--text-${color.id})` : ''
								const displayColor = mounted && resolvedTheme === 'dark' ? color.text.dark : color.text.light

								return (
									<DropdownMenu.Item
										key={'text-' + color.label}
										onClick={() => {
											if (value === '') {
												editor.chain().focus().unsetColor().run()
											} else {
												editor.chain().focus().setColor(value).run()
											}
										}}
										className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none"
									>
										<span className="material-symbols-outlined text-[16px]" style={{ color: displayColor || 'inherit' }}>
											format_color_text
										</span>
										<span>{color.label}</span>
									</DropdownMenu.Item>
								)
							})}
						</div>

						<div className="h-px bg-black/10 dark:bg-white/10 my-2 mx-1" />

						<div className="text-xs font-semibold text-on-surface-variant mb-2 px-2 uppercase tracking-wider">Background</div>
						<div className="flex flex-col gap-0.5">
							{COLORS.map((color) => {
								const value = color.id ? `var(--highlight-${color.id})` : ''
								const displayColor = mounted && resolvedTheme === 'dark' ? color.highlight.dark : color.highlight.light
								const iconColor = displayColor ? (mounted && resolvedTheme === 'dark' ? '#fff' : '#1a1a1a') : 'inherit'

								return (
									<DropdownMenu.Item
										key={'bg-' + color.label}
										onClick={() => {
											if (value === '') {
												editor.chain().focus().unsetHighlight().run()
											} else {
												editor.chain().focus().setHighlight({ color: value }).run()
											}
										}}
										className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none"
									>
										<div className="w-5 h-5 rounded flex items-center justify-center border border-black/10 dark:border-white/10" style={{ backgroundColor: displayColor || 'transparent', color: iconColor }}>
											<span className="material-symbols-outlined text-[14px]">format_color_fill</span>
										</div>
										<span>{color.label}</span>
									</DropdownMenu.Item>
								)
							})}
						</div>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		</>
	)
}
