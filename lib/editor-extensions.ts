import { AnyExtension } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { StarterKit } from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Markdown } from 'tiptap-markdown'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TextStyle } from '@tiptap/extension-text-style'
import { FontFamily } from '@tiptap/extension-font-family'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { Underline } from '@tiptap/extension-underline'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { PersistentSelection } from '@/lib/persistent-selection'
import { Callout } from '@/lib/callout'

const lowlight = createLowlight(common)

const CustomDocument = Document.extend({
	content: 'heading block*',
})

/**
 * The single Tiptap extension list shared by the live editor, the markdown
 * paste path, the version-restore headless editors, and the round-trip
 * engine (`lib/markdown-io.ts`). Page-context-only extensions
 * (collaboration, cursors, slash menu, mentions) stay in
 * `editor-workspace.tsx`.
 *
 * The root document is the one deliberate seam: the live editor constrains
 * content to `heading block*` so every page doc opens with a title heading.
 * The round-trip engine must handle arbitrary markdown (which may not start
 * with a heading), so it passes a plain `block+` document.
 */
export const getSharedExtensions = (options?: { document?: AnyExtension }): AnyExtension[] => [
	options?.document ?? CustomDocument,
	PersistentSelection,
	StarterKit.configure({
		document: false,
		codeBlock: false,
		link: false,
		underline: false,
		undoRedo: false,
	}),
	CodeBlockLowlight.configure({
		lowlight,
	}),
	Table.configure({
		resizable: true,
	}),
	TableRow,
	TableHeader,
	TableCell,
	Markdown.configure({
		html: true,
		transformPastedText: true,
		transformCopiedText: true,
	}),
	Placeholder.configure({
		placeholder: ({ node }) => {
			if (node.type.name === 'heading') {
				return 'Untitled Document'
			}
			return 'Type / to choose a block, or start typing...'
		},
	}),
	TextStyle,
	FontFamily,
	Color,
	Highlight.configure({ multicolor: true }),
	TextAlign.configure({ types: ['heading', 'paragraph'] }),
	Underline,
	TaskList,
	TaskItem.configure({ nested: true }),
	Callout,
	Image.configure({
		inline: true,
		allowBase64: true,
	}),
	Link.configure({
		openOnClick: false,
		autolink: true,
	}),
]
