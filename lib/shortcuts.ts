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

export const BROWSER_RESERVED_NOTE =
	'⌘W, ⌘T, ⌘N and ⌘⇧T belong to the browser — Lekhan does not override them.'

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
				description: 'Type / at the start of a line for headings, lists, tables and callouts.',
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
