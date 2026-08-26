import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const WIKILINK_REGEX = /\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g

export interface ParsedWikilink {
	raw: string
	target: string
	alias: string | null
	from: number
	to: number
}

export interface WorkspacePageSummary {
	id: string
	title: string
}

export interface WikilinkOptions {
	workspacePages?: WorkspacePageSummary[]
	onNavigateToPage?: (pageId: string) => void
	onCreatePage?: (title: string) => void
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		wikilink: {
			setWorkspacePages: (pages: WorkspacePageSummary[]) => ReturnType
		}
	}

	interface Storage {
		wikilink: {
			workspacePages: WorkspacePageSummary[]
			pagesMap: Map<string, WorkspacePageSummary>
		}
	}
}

export function normalizeWikilinkTarget(title: string): string {
	return String(title || '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim()
}

export function parseWikilinksInText(text: string): ParsedWikilink[] {
	if (typeof text !== 'string' || !text.includes('[[')) return []
	const results: ParsedWikilink[] = []
	WIKILINK_REGEX.lastIndex = 0
	let match: RegExpExecArray | null

	while ((match = WIKILINK_REGEX.exec(text)) !== null) {
		const raw = match[0]
		const target = match[1].trim()
		if (!target) continue
		const alias = match[2] ? match[2].trim() : null
		results.push({
			raw,
			target,
			alias,
			from: match.index,
			to: match.index + raw.length,
		})
	}
	return results
}

export function createWikilinkDecorations(
	doc: any,
	pagesMap: Map<string, WorkspacePageSummary>
): DecorationSet {
	const decorations: Decoration[] = []

	doc.descendants((node: any, pos: number) => {
		if (node.isText && node.text) {
			const text = node.text
			const links = parseWikilinksInText(text)

			for (const link of links) {
				const from = pos + link.from
				const to = pos + link.to
				const normalized = normalizeWikilinkTarget(link.target)
				const resolved = pagesMap.get(normalized)

				if (resolved) {
					decorations.push(
						Decoration.inline(from, to, {
							class:
								'wikilink wikilink-resolved inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer border border-primary/20 transition-colors',
							'data-wikilink-target': link.target,
							'data-wikilink-resolved': 'true',
							'data-wikilink-page-id': resolved.id,
							title: `Open page: ${resolved.title}`,
						})
					)
				} else {
					decorations.push(
						Decoration.inline(from, to, {
							class:
								'wikilink wikilink-unresolved inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium text-muted-foreground bg-muted/40 hover:bg-muted hover:text-foreground cursor-pointer border border-dashed border-muted-foreground/30 transition-colors',
							'data-wikilink-target': link.target,
							'data-wikilink-resolved': 'false',
							title: `Page "${link.target}" not found. Click to create.`,
						})
					)
				}
			}
		}
	})

	return DecorationSet.create(doc, decorations)
}

export const wikilinkPluginKey = new PluginKey('wikilink')

export const Wikilink = Extension.create<WikilinkOptions>({
	name: 'wikilink',

	addOptions() {
		return {
			workspacePages: [],
			onNavigateToPage: undefined,
			onCreatePage: undefined,
		}
	},

	addStorage() {
		const pages = this.options.workspacePages || []
		const map = new Map<string, WorkspacePageSummary>()
		for (const p of pages) {
			map.set(normalizeWikilinkTarget(p.title), p)
		}
		return {
			workspacePages: pages,
			pagesMap: map,
		}
	},

	addCommands() {
		return {
			setWorkspacePages:
				(pages: WorkspacePageSummary[]) =>
				({ tr, dispatch }) => {
					if (dispatch) {
						this.storage.workspacePages = pages
						const map = new Map<string, WorkspacePageSummary>()
						for (const p of pages) {
							map.set(normalizeWikilinkTarget(p.title), p)
						}
						this.storage.pagesMap = map
						tr.setMeta(wikilinkPluginKey, { pages })
					}
					return true
				},
		}
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: wikilinkPluginKey,
				state: {
					init: (_, state) => {
						return createWikilinkDecorations(state.doc, this.storage.pagesMap)
					},
					apply: (tr, oldDecoSet, _oldState, newState) => {
						const meta = tr.getMeta(wikilinkPluginKey)
						if (meta || tr.docChanged) {
							return createWikilinkDecorations(newState.doc, this.storage.pagesMap)
						}
						return oldDecoSet.map(tr.mapping, tr.doc)
					},
				},
				props: {
					decorations: (state) => {
						return wikilinkPluginKey.getState(state) || DecorationSet.empty
					},
					handleClick: (_view, _pos, event) => {
						const targetEl = (event.target as HTMLElement | null)?.closest(
							'[data-wikilink-target]'
						) as HTMLElement | null
						if (!targetEl) return false

						const target = targetEl.getAttribute('data-wikilink-target')
						const isResolved = targetEl.getAttribute('data-wikilink-resolved') === 'true'
						const pageId = targetEl.getAttribute('data-wikilink-page-id')

						if (isResolved && pageId && this.options.onNavigateToPage) {
							event.preventDefault()
							this.options.onNavigateToPage(pageId)
							return true
						}

						if (!isResolved && target && this.options.onCreatePage) {
							event.preventDefault()
							this.options.onCreatePage(target)
							return true
						}

						return false
					},
				},
			}),
		]
	},
})
