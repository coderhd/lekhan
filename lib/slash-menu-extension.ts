import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'

export interface SlashMenuItem {
	id: string
	label: string
	icon: string
	description?: string
	action: (editor: any) => void
}

export const SlashMenuExtension = Extension.create({
	name: 'slashMenu',

	addOptions() {
		return {
			suggestion: {
				char: '/',
				command: ({
					editor,
					range,
					props,
				}: {
					editor: any
					range: any
					props: SlashMenuItem
				}) => {
					editor.chain().focus().deleteRange(range).run()
					props.action(editor)
				},
			} as Partial<SuggestionOptions>,
		}
	},

	addProseMirrorPlugins() {
		return [
			Suggestion({
				editor: this.editor,
				...this.options.suggestion,
			}),
		]
	},
})

export function buildSlashMenuItems(
	onOpenLekhanBot: () => void,
): SlashMenuItem[] {
	return [
		{
			id: 'heading-1',
			label: 'Heading 1',
			icon: 'format_h1',
			description: 'Large section heading',
			action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
		},
		{
			id: 'heading-2',
			label: 'Heading 2',
			icon: 'format_h2',
			description: 'Medium section heading',
			action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
		},
		{
			id: 'heading-3',
			label: 'Heading 3',
			icon: 'format_h3',
			description: 'Small section heading',
			action: (editor) => editor.chain().focus().toggleHeading({ level: 4 }).run(),
		},
		{
			id: 'bullet-list',
			label: 'Bullet List',
			icon: 'format_list_bulleted',
			description: 'Unordered list',
			action: (editor) => editor.chain().focus().toggleBulletList().run(),
		},
		{
			id: 'numbered-list',
			label: 'Numbered List',
			icon: 'format_list_numbered',
			description: 'Ordered list',
			action: (editor) => editor.chain().focus().toggleOrderedList().run(),
		},
		{
			id: 'task-list',
			label: 'Task List',
			icon: 'checklist',
			description: 'Checklist with toggles',
			action: (editor) => editor.chain().focus().toggleTaskList().run(),
		},
		{
			id: 'table',
			label: 'Table',
			icon: 'table',
			description: 'Insert a 3x3 table',
			action: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
		},
		{
			id: 'code-block',
			label: 'Code Block',
			icon: 'code_blocks',
			description: 'Fenced syntax-highlighted code block',
			action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
		},
		{
			id: 'divider',
			label: 'Divider',
			icon: 'horizontal_rule',
			description: 'Horizontal separator',
			action: (editor) => editor.chain().focus().setHorizontalRule().run(),
		},
		{
			// id is 'l' (not 'ai') so that typing "/l" — matching the Cmd/Ctrl+L
			// shortcut — can resolve to this entry directly. See the exact-id-match
			// priority in editor-workspace.tsx's items() filter.
			id: 'l',
			label: 'Ask Lekhan Bot',
			icon: 'auto_awesome',
			description: 'AI writing assistant (⌘L)',
			action: () => onOpenLekhanBot(),
		},
	]
}
