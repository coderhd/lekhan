import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'

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
	/**
	 * `[[` autocomplete popup wiring (SIL-159). When provided, typing `[[`
	 * mid-block opens a Suggestion-driven popup over the workspace page list.
	 * The consumer supplies `items`/`command`/`render` so React components and
	 * handlers stay at the surface level (same pattern as the slash menu).
	 */
	suggestion?: Partial<SuggestionOptions> | null
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

// --- `[[` autocomplete (SIL-159) ------------------------------------------

export const wikilinkSuggestionPluginKey = new PluginKey('wikilinkSuggestion')

/**
 * Explicitly exit the `[[` popup after committing a real link. Without this
 * the Suggestion state machine re-runs its matcher on the commit transaction
 * and re-opens the popup over the just-inserted text (clean-room review
 * finding 2) — Obsidian closes the popup on commit.
 */
export function exitWikilinkSuggestion (editor: any) {
	const view = editor?.view
	if (!view?.state) return
	view.dispatch(view.state.tr.setMeta(wikilinkSuggestionPluginKey, { exit: true }))
}

/**
 * Default `shouldShow` for the `[[` popup (clean-room review round 2, Axis 3):
 * Tiptap's Suggestion matcher only inspects the text **before** the caret, so
 * sitting the caret inside an already closed link ("[[Meeting Notes]] done",
 * caret after "Me") still "matches" — and committing would replace only the
 * prefix, orphaning the `]]` tail into the CRDT document. Suppress the popup
 * whenever the forward text from the range end reaches a closing `]]` before
 * any opener (`[[`), `|`, or other grammar breaker — the link under the caret
 * is already closed — or whenever the query itself was typed through a
 * closer.
 */
const WIKILINK_SNIFF_LIMIT = 256

export function isInsideClosedWikilink (doc: any, to: number): boolean {
	if (!doc?.textBetween) return false
	try {
		const size = doc.content.size
		const text = doc.textBetween(Math.min(to, size), Math.min(to + WIKILINK_SNIFF_LIMIT, size), '\n\n') || ''
		// Inside a wikilink body only `[^[\]|]` characters are legal; the first
		// grammar character encountered decides. `|` is deliberately NOT a
		// breaker: it appears both in an open alias being typed ("[[t|al") and
		// ahead of the closing "]]" of a closed link ("[[t|al]]") — only that
		// closing "]]" (or an opener) proves the caret's position either way
		// (clean-room round 3 residual blocker).
		for (let i = 0; i < text.length; i++) {
			const ch = text[i]
			if (ch === ']') return text[i + 1] === ']'
			if (ch === '[') return false
		}
		return false
	} catch {
		return false
	}
}

export function defaultWikilinkSuggestionShouldShow ({
	editor,
	range,
	query,
}: {
	editor: any
	range: { from: number; to: number }
	query?: string
}): boolean {
	if (String(query || '').includes(']]')) return false
	try {
		const doc = editor?.state?.doc
		if (doc && range && isInsideClosedWikilink(doc, range.to)) return false
	} catch {
		// Never let popup suppression logic crash the popup; default open.
	}
	return true
}

/** Characters that cannot round-trip through the wikilink grammar. */
const UNLINKABLE_CHARS_ALL = /[[\]|]/g

function sanitizeWikilinkTarget (title: string): string {
	return String(title || '').replace(UNLINKABLE_CHARS_ALL, '').trim()
}

// Stateless (no /g) — .test() on a global regex advances lastIndex.
function isLinkableTitle (title: string): boolean {
	return !/[[\]|]/.test(String(title || ''))
}

export type WikilinkSuggestionKind = 'page' | 'create' | 'hint'

export interface WikilinkSuggestionItem {
	id: string
	title: string
	kind: WikilinkSuggestionKind
}

export const WIKILINK_CREATE_ITEM_ID = '__wikilink_create__'
export const WIKILINK_HINT_ITEM_ID = '__wikilink_hint__'

const WIKILINK_SUGGEST_MAX_ITEMS = 8

/**
 * Pure worker behind the `[[` popup's `items` callback so filtering is unit
 *	testable and the popup stays capped at real workspace size (no unbounded
 *	lists — #137/#142 hard lesson).
 *
 * - Query matches are case- and whitespace-insensitive via the same
 *   normalize used to resolve links (so what you pick resolves right after).
 * - The list is always capped at `max` page results.
 * - A **create affordance** ("Create “<query>”") is appended whenever the
 *   query is non-empty and no existing page matches it exactly — this is the
 *   empty-state requirement from #142. A non-interactive **hint** replaces it
 *   when the query is empty and the workspace has no pages yet.
 */
export function buildWikilinkSuggestions (
	pages: WorkspacePageSummary[],
	query: string,
	max = WIKILINK_SUGGEST_MAX_ITEMS,
): WikilinkSuggestionItem[] {
	const trimmed = String(query || '').trim()
	const normalizedQuery = normalizeWikilinkTarget(trimmed)
	// Titles carrying grammar characters ("Team Notes | Weekly", "my [page")
	// would never resolve once committed — drop them from the popup rather
	// than suggest pages whose link can't round-trip (clean-room finding 3).
	const linkable = pages.filter(p => isLinkableTitle(p.title))
	const results: WikilinkSuggestionItem[] = linkable
		.filter(p => normalizeWikilinkTarget(p.title).includes(normalizedQuery))
		.slice(0, max)
		.map(p => ({
			id: p.id,
			title: p.title,
			kind: 'page' as const,
		}))

	// Empty query: show the workspace's pages as-is; if the workspace is
	// empty there is nothing to link yet — guide instead of leaving a blank.
	if (!normalizedQuery) {
		if (results.length === 0) {
			results.push({ id: WIKILINK_HINT_ITEM_ID, title: '', kind: 'hint' })
		}
		return results
	}

	const hasExactMatch = normalizedQuery.length > 0 &&
		linkable.some(p => normalizeWikilinkTarget(p.title) === normalizedQuery)
	if (!hasExactMatch) {
		const safeTarget = sanitizeWikilinkTarget(trimmed)
		if (safeTarget) {
			results.push({ id: WIKILINK_CREATE_ITEM_ID, title: safeTarget, kind: 'create' })
		} else if (results.length === 0) {
			// A query of nothing but grammar characters ("[[") sanitizes to an
			// empty create target and matches no pages — show the guide hint
			// rather than a bare empty popup (clean-room round 2 NIT).
			results.push({ id: WIKILINK_HINT_ITEM_ID, title: '', kind: 'hint' })
		}
	}
	return results
}


export const Wikilink = Extension.create<WikilinkOptions>({
	name: 'wikilink',

	addOptions() {
		return {
			workspacePages: [],
			onNavigateToPage: undefined,
			onCreatePage: undefined,
			suggestion: undefined,
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
		const plugins: Plugin[] = [
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

		// Opt-in `[[` autocomplete popup (SIL-159): only mounted when the
		// consumer configures a suggestion, keeping decoration-only usages
		// (markdown export, tests) free of popup behavior. Own pluginKey by
		// default — the shared "suggestion" key would collide with the
		// Mention/Slash Suggestion plugins in the same editor state.
		//
		// shouldShow composes the consumer's filter (if any) with the
		// grammar guard below: without it, sitting the caret inside an
		// already-closed "[[Link]]" still matches (the Suggestion matcher
		// only reads text before the caret) and a commit would orphan the
		// `]]` tail into the document (clean-room round 2, Axis 3 BLOCKER).
		if (this.options.suggestion) {
			const consumer: any = this.options.suggestion
			const { shouldShow: consumerShouldShow, ...suggestionOptions } = consumer
			plugins.push(Suggestion({
				editor: this.editor,
				pluginKey: wikilinkSuggestionPluginKey,
				...suggestionOptions,
				shouldShow: (args: any) => {
					if (consumerShouldShow && !consumerShouldShow(args)) return false
					return defaultWikilinkSuggestionShouldShow(args)
				},
			}))
		}

		return plugins
	},
})
