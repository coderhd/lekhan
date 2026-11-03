/**
 * The single source of truth for every keyboard gesture Lekhan actually
 * implements. The help dialog renders straight from this list, so adding a
 * shortcut to the app without listing it here is a bug — and listing a
 * shortcut that does not exist is worse.
 *
 * Keep the wording honest: gestures we do not have (publishing, backlinks,
 * export) are either omitted or explicitly marked as having no shortcut, and
 * keys the browser owns are called out instead of claimed.
 */

export interface ShortcutKey {
	/** Display token on macOS (⌘, ⇧, K, Esc, …). */
	mac: string
	/** Display token elsewhere (Ctrl, Shift, K, Esc, …). */
	other: string
}

export interface ShortcutItem {
	id: string
	label: string
	description: string
	/** Key combination, when the gesture is a key press. */
	keys?: ShortcutKey[]
	/** Literal text the user types, for syntax gestures like [[Page title]]. */
	gesture?: string
	/** Extra honesty for gestures that are not keyboard shortcuts. */
	note?: string
}

export interface ShortcutGroup {
	id: string
	title: string
	items: ShortcutItem[]
}

/** Browser-owned combinations, phrased for the platform the dialog is showing. */
export function browserReservedNote (platform: 'mac' | 'other'): string {
	const cmd = platform === 'mac' ? '⌘' : 'Ctrl+'
	const shift = platform === 'mac' ? '⇧' : 'Shift+'
	return `${cmd}W, ${cmd}T, ${cmd}N and ${cmd}${shift}T belong to the browser — Lekhan does not override them.`
}

/** macOS wording; kept as a constant for copy that is not platform-aware. */
export const BROWSER_RESERVED_NOTE = browserReservedNote('mac')

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
	{
		id: 'anywhere',
		title: 'Anywhere',
		items: [
			{
				id: 'palette',
				label: 'Search pages',
				description: 'Open the quick-switch palette from any signed-in page.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: 'K', other: 'K' },
				],
			},
			{
				id: 'help',
				label: 'Shortcut help',
				description: 'Open this list. It stays quiet while you are typing.',
				keys: [{ mac: '?', other: '?' }],
			},
		],
	},
	{
		id: 'writing',
		title: 'While writing',
		items: [
			{
				id: 'slash',
				label: 'Insert a block',
				description: 'Type / to open the block menu — headings, lists, tables and callouts.',
				gesture: '/',
			},
			{
				id: 'wikilink',
				label: 'Link a page',
				description: 'Type a page title in double brackets to link it. Unknown titles are flagged inline.',
				gesture: '[[Page title]]',
			},
			{
				id: 'bot',
				label: 'Ask Lekhan Bot',
				description: 'Open the writing assistant bar.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: 'L', other: 'L' },
				],
			},
			{
				id: 'history',
				label: 'Version history',
				description: 'Review and restore earlier snapshots of this page.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: '⇧', other: 'Shift' },
					{ mac: 'S', other: 'S' },
				],
			},
			{
				id: 'copy',
				label: 'Copy as Markdown',
				description: 'The normal copy command, but it writes Obsidian-compatible Markdown.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: 'C', other: 'C' },
				],
			},
			{
				id: 'paste',
				label: 'Paste Markdown',
				description: 'The normal paste command, but it converts Markdown and Notion HTML into blocks.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: 'V', other: 'V' },
				],
			},
		],
	},
	{
		id: 'formatting',
		title: 'Formatting',
		items: [
			{
				id: 'bold',
				label: 'Bold',
				description: 'Toggle bold on the selection.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: 'B', other: 'B' },
				],
			},
			{
				id: 'italic',
				label: 'Italic',
				description: 'Toggle italics on the selection.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: 'I', other: 'I' },
				],
			},
			{
				id: 'underline',
				label: 'Underline',
				description: 'Toggle underline on the selection.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: 'U', other: 'U' },
				],
			},
			{
				id: 'strike',
				label: 'Strikethrough',
				description: 'Toggle strikethrough. Version history keeps ⌘⇧S.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: '⇧', other: 'Shift' },
					{ mac: 'X', other: 'X' },
				],
			},
			{
				id: 'code',
				label: 'Inline code',
				description: 'Wrap the selection as inline code.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: 'E', other: 'E' },
				],
			},
			{
				id: 'quote',
				label: 'Blockquote',
				description: 'Turn the current block into a quote.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: '⇧', other: 'Shift' },
					{ mac: 'B', other: 'B' },
				],
			},
			{
				id: 'bullet-list',
				label: 'Bullet list',
				description: 'Toggle a bulleted list.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: '⇧', other: 'Shift' },
					{ mac: '8', other: '8' },
				],
			},
			{
				id: 'ordered-list',
				label: 'Numbered list',
				description: 'Toggle a numbered list.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: '⇧', other: 'Shift' },
					{ mac: '7', other: '7' },
				],
			},
			{
				id: 'heading',
				label: 'Heading 1–6',
				description: 'Turn the current block into a heading of that level.',
				keys: [
					{ mac: '⌘', other: 'Ctrl' },
					{ mac: '⌥', other: 'Alt' },
					{ mac: '1–6', other: '1–6' },
				],
			},
		],
	},
	{
		id: 'dialogs',
		title: 'Dialogs and publishing',
		items: [
			{
				id: 'escape',
				label: 'Close anything',
				description: 'Dismiss the palette, this list, or any open dialog.',
				keys: [{ mac: 'Esc', other: 'Esc' }],
			},
			{
				id: 'share',
				label: 'Share or publish a page',
				description: 'Open Share in the editor header to invite people or publish a public link.',
				note: 'No keyboard shortcut yet.',
			},
		],
	},
]

/** Tags that own the keyboard while focused — `?` there must stay a character. */
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * True when the event target (or the active element) is a text field or the
 * editor. Used to keep single-key shortcuts from stealing typed characters.
 * jsdom does not implement `isContentEditable`, so the attribute is checked too.
 */
export function isTypingTarget (target: EventTarget | null | undefined): boolean {
	const el = target as HTMLElement | null | undefined
	if (!el || typeof el.tagName !== 'string') return false

	if (TYPING_TAGS.has(el.tagName)) return true
	if (el.isContentEditable) return true

	const editable = el.closest?.('[contenteditable]')?.getAttribute('contenteditable')
	return editable === '' || editable === 'true' || editable === 'plaintext-only'
}

/** Platform-aware label for a key combination. */
export function formatShortcut (keys: ShortcutKey[], platform: 'mac' | 'other'): string {
	return keys.map(key => (platform === 'mac' ? key.mac : key.other)).join(platform === 'mac' ? '' : '+')
}

/** Best-effort platform guess; only affects which labels the dialog shows. */
export function detectShortcutPlatform (): 'mac' | 'other' {
	if (typeof navigator === 'undefined') return 'other'
	return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? 'mac' : 'other'
}
