'use client'

import { memo } from 'react'
import { Editor, useEditorState } from '@tiptap/react'
import { CustomSelect, type SelectOption } from './ui/custom-select'
import { ColorHighlightPopover } from './color-highlight-popover'
import { ImageUploadButton } from './image-upload-button'

/**
 * Formatting toolbar for the page editor.
 *
 * It is deliberately its own memoized component rather than inline JSX in
 * `EditorWorkspace` (SIL-230 / #144). The workspace owns a lot of state that
 * changes for reasons unrelated to formatting — sync/dirty flags, presence,
 * theme, panels — and every one of those used to re-render the whole toolbar
 * and its dropdown scopes. Now:
 *
 *  - `React.memo` + stable props keep it out of parent-driven re-renders.
 *  - `useEditorState` subscribes only to the formatting state it paints, with
 *    a shallow comparison, so typing a character that does not change the
 *    active marks cost zero toolbar renders.
 */

const FONT_FAMILY_OPTIONS: SelectOption[] = [
	{ label: 'Inter (Default)', value: '' },
	{ label: 'Arial', value: 'Arial, Helvetica, sans-serif', style: { fontFamily: 'Arial, Helvetica, sans-serif' } },
	{ label: 'Comic Sans', value: 'Comic Sans MS, Comic Sans', style: { fontFamily: 'Comic Sans MS, Comic Sans' } },
	{ label: 'Georgia', value: 'Georgia, serif', style: { fontFamily: 'Georgia, serif' } },
	{ label: 'Courier New', value: '"Courier New", Courier, monospace', style: { fontFamily: '"Courier New", Courier, monospace' } },
]

const TEXT_STYLE_OPTIONS: SelectOption[] = [
	{ label: 'Title', value: 'h1', style: { fontSize: '24px', fontWeight: 700 } },
	{ label: 'Heading', value: 'h2', style: { fontSize: '18px', fontWeight: 600 } },
	{ label: 'Subheading', value: 'h3', style: { fontSize: '14px', fontWeight: 600 } },
	{ label: 'Body', value: 'p', style: { fontSize: '14px', fontWeight: 400 } },
]

interface ToolbarState {
	fontFamily: string
	textStyle: string
	bold: boolean
	italic: boolean
	underline: boolean
	strike: boolean
	align: '' | 'left' | 'center' | 'right'
	bulletList: boolean
	orderedList: boolean
	taskList: boolean
	blockquote: boolean
	codeBlock: boolean
	link: boolean
	table: boolean
}

const EMPTY_STATE: ToolbarState = {
	fontFamily: '',
	textStyle: 'p',
	bold: false,
	italic: false,
	underline: false,
	strike: false,
	align: '',
	bulletList: false,
	orderedList: false,
	taskList: false,
	blockquote: false,
	codeBlock: false,
	link: false,
	table: false,
}

function selectToolbarState(editor: Editor | null): ToolbarState {
	if (!editor) return EMPTY_STATE
	return {
		fontFamily: editor.getAttributes('textStyle').fontFamily || '',
		textStyle: editor.isActive('heading', { level: 1 }) ? 'h1'
			: editor.isActive('heading', { level: 2 }) ? 'h2'
				: editor.isActive('heading', { level: 3 }) ? 'h3' : 'p',
		bold: editor.isActive('bold'),
		italic: editor.isActive('italic'),
		underline: editor.isActive('underline'),
		strike: editor.isActive('strike'),
		align: editor.isActive({ textAlign: 'center' }) ? 'center'
			: editor.isActive({ textAlign: 'right' }) ? 'right'
				// TextAlign defaults to null on unstyled paragraphs, so "no
				// alignment" is its own state — matching the old inline
				// toolbar, which never lit Align Left by default (SIL-230
				// review F2 / #79 parity).
				: editor.isActive({ textAlign: 'left' }) ? 'left' : '',
		bulletList: editor.isActive('bulletList'),
		orderedList: editor.isActive('orderedList'),
		taskList: editor.isActive('taskList'),
		blockquote: editor.isActive('blockquote'),
		codeBlock: editor.isActive('codeBlock'),
		link: editor.isActive('link'),
		table: editor.isActive('table'),
	}
}

function shallowEqualState (a: ToolbarState | null, b: ToolbarState | null) {
	if (a === b) return true
	if (!a || !b) return false
	const keys = Object.keys(a) as (keyof ToolbarState)[]
	for (const key of keys) {
		if (a[key] !== b[key]) return false
	}
	return true
}

interface EditorToolbarProps {
	editor: Editor | null
	onOpenLinkPrompt: () => void
	disabled?: boolean
}

function EditorToolbarImpl ({ editor, onOpenLinkPrompt, disabled = false }: EditorToolbarProps) {
	const state = useEditorState({
		editor,
		selector: ({ editor: current }) => selectToolbarState(current),
		equalityFn: shallowEqualState,
	}) ?? EMPTY_STATE

	const activeButton = 'text-primary bg-primary/10'
	const idleButton = 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'
	const buttonClass = (active: boolean) =>
		`p-1 rounded transition-colors flex items-center justify-center ${active ? activeButton : idleButton}`

	return (
		<div className={`min-h-[40px] py-2 px-6 md:px-10 flex flex-nowrap overflow-x-auto hide-scrollbar justify-start xl:justify-center items-center bg-surface-container-low border-y border-black/10 dark:border-white/10 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
			{/* Font Family Selection */}
			<div className='flex shrink-0 items-center border-r border-black/10 dark:border-white/10 h-6 px-1'>
				<CustomSelect
					value={state.fontFamily}
					onValueChange={(val) => {
						if (val === '') {
							editor?.chain().focus().unsetFontFamily().run()
						} else {
							editor?.chain().focus().setFontFamily(val).run()
						}
					}}
					options={FONT_FAMILY_OPTIONS}
					triggerClassName='h-8 w-[140px] border-none bg-transparent hover:bg-black/5 dark:hover:bg-white/10 px-2 font-medium focus:ring-0'
					contentClassName='w-[160px]'
				/>
			</div>

			{/* Text Style / Headings Selection */}
			<div className='flex shrink-0 items-center border-r border-black/10 dark:border-white/10 h-6 px-1'>
				<CustomSelect
					value={state.textStyle}
					onValueChange={(val) => {
						if (val === 'p') {
							editor?.chain().focus().setParagraph().run()
						} else if (val === 'h1') {
							editor?.chain().focus().toggleHeading({ level: 1 }).run()
						} else if (val === 'h2') {
							editor?.chain().focus().toggleHeading({ level: 2 }).run()
						} else if (val === 'h3') {
							editor?.chain().focus().toggleHeading({ level: 3 }).run()
						}
					}}
					options={TEXT_STYLE_OPTIONS}
					triggerClassName='h-8 w-[140px] border-none bg-transparent hover:bg-black/5 dark:hover:bg-white/10 px-2 font-medium focus:ring-0'
					contentClassName='w-auto min-w-[160px] whitespace-nowrap'
				/>
			</div>

			<div className='flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6'>
				<button onClick={() => editor?.chain().focus().undo().run()} className='p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors text-on-surface-variant hover:text-on-surface flex items-center justify-center' title='Undo'><span className='material-symbols-outlined text-[18px]'>undo</span></button>
				<button onClick={() => editor?.chain().focus().redo().run()} className='p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors text-on-surface-variant hover:text-on-surface flex items-center justify-center' title='Redo'><span className='material-symbols-outlined text-[18px]'>redo</span></button>
			</div>
			<div className='flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6'>
				<button onClick={() => editor?.chain().focus().toggleBold().run()} className={buttonClass(state.bold)} title='Bold'><span className='material-symbols-outlined text-[18px]'>format_bold</span></button>
				<button onClick={() => editor?.chain().focus().toggleItalic().run()} className={buttonClass(state.italic)} title='Italic'><span className='material-symbols-outlined text-[18px]'>format_italic</span></button>
				<button onClick={() => editor?.chain().focus().toggleUnderline().run()} className={buttonClass(state.underline)} title='Underline'><span className='material-symbols-outlined text-[18px]'>format_underlined</span></button>
				<button onClick={() => editor?.chain().focus().toggleStrike().run()} className={buttonClass(state.strike)} title='Strike'><span className='material-symbols-outlined text-[18px]'>format_strikethrough</span></button>
			</div>
			<div className='flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6'>
				<button onClick={() => editor?.chain().focus().setTextAlign('left').run()} className={buttonClass(state.align === 'left')} title='Align Left'><span className='material-symbols-outlined text-[18px]'>format_align_left</span></button>
				<button onClick={() => editor?.chain().focus().setTextAlign('center').run()} className={buttonClass(state.align === 'center')} title='Align Center'><span className='material-symbols-outlined text-[18px]'>format_align_center</span></button>
				<button onClick={() => editor?.chain().focus().setTextAlign('right').run()} className={buttonClass(state.align === 'right')} title='Align Right'><span className='material-symbols-outlined text-[18px]'>format_align_right</span></button>
			</div>
			<div className='flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6'>
				<button onClick={() => editor?.chain().focus().toggleBulletList().run()} className={buttonClass(state.bulletList)} title='Bullet List'><span className='material-symbols-outlined text-[18px]'>format_list_bulleted</span></button>
				<button onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={buttonClass(state.orderedList)} title='Ordered List'><span className='material-symbols-outlined text-[18px]'>format_list_numbered</span></button>
				<button onClick={() => editor?.chain().focus().toggleTaskList().run()} className={buttonClass(state.taskList)} title='Task List'><span className='material-symbols-outlined text-[18px]'>check_box</span></button>
				<button onClick={() => editor?.chain().focus().toggleBlockquote().run()} className={buttonClass(state.blockquote)} title='Blockquote'><span className='material-symbols-outlined text-[18px]'>format_quote</span></button>
				<button onClick={() => editor?.chain().focus().toggleCodeBlock().run()} className={buttonClass(state.codeBlock)} title='Code Block'><span className='material-symbols-outlined text-[18px]'>code_blocks</span></button>
			</div>
			<div className='flex shrink-0 items-center gap-xs px-md h-6 border-r border-black/10 dark:border-white/10'>
				<button
					onClick={onOpenLinkPrompt}
					className={buttonClass(state.link)}
					title='Link'
				>
					<span className='material-symbols-outlined text-[18px]'>link</span>
				</button>
				<ImageUploadButton onUpload={(url) => editor?.chain().focus().setImage({ src: url }).run()} />
				<button
					onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
					className={buttonClass(state.table)}
					title='Insert Table'
				>
					<span className='material-symbols-outlined text-[18px]'>table</span>
				</button>
			</div>
			<div className='flex shrink-0 items-center gap-xs px-md h-6'>
				<ColorHighlightPopover editor={editor} />
			</div>
		</div>
	)
}

export const EditorToolbar = memo(EditorToolbarImpl)
