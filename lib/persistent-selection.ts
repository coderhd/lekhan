import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PersistentSelectionOptions {}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		persistentSelection: {
			setBotActive: (active: boolean) => ReturnType
			updatePersistentSelection: (range: { from: number; to: number } | null) => ReturnType
		}
	}

	interface Storage {
		persistentSelection: {
			isBotActive: boolean
			activeRange: { from: number; to: number } | null
		}
	}
}

export const persistentSelectionPluginKey = new PluginKey('persistentSelection')

export const PersistentSelection = Extension.create<PersistentSelectionOptions>({
	name: 'persistentSelection',

	addStorage() {
		return {
			isBotActive: false,
			activeRange: null as { from: number; to: number } | null,
		}
	},

	addCommands() {
		return {
			setBotActive: (active: boolean) => ({ editor, tr, dispatch }) => {
				this.storage.isBotActive = active
				if (active) {
					const { selection } = editor.state
					if (!selection.empty) {
						this.storage.activeRange = { from: selection.from, to: selection.to }
					}
				} else {
					this.storage.activeRange = null
				}
				if (dispatch) {
					tr.setMeta(persistentSelectionPluginKey, { isBotActive: active, range: this.storage.activeRange })
				}
				return true
			},
			updatePersistentSelection: (range: { from: number; to: number } | null) => ({ tr, dispatch }) => {
				this.storage.activeRange = range
				if (dispatch) {
					tr.setMeta(persistentSelectionPluginKey, { range })
				}
				return true
			},
		}
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: persistentSelectionPluginKey,
				state: {
					init: () => {
						return { range: null as { from: number; to: number } | null }
					},
					apply: (tr, value, _oldState, newState) => {
						const meta = tr.getMeta(persistentSelectionPluginKey)
						if (meta) {
							if (meta.isBotActive === false) {
								this.storage.activeRange = null
								return { range: null }
							}
							if (meta.range !== undefined) {
								this.storage.activeRange = meta.range
								return { range: meta.range }
							}
						}

						if (this.storage.isBotActive) {
							const selection = tr.selection || newState.selection
							if (selection && !selection.empty) {
								const range = { from: selection.from, to: selection.to }
								this.storage.activeRange = range
								return { range }
							}
						}

						if (!this.storage.isBotActive) {
							this.storage.activeRange = null
							return { range: null }
						}

						return value
					},
				},
				props: {
					decorations: (state) => {
						if (!this.storage.isBotActive) {
							return DecorationSet.empty
						}

						const pluginState = persistentSelectionPluginKey.getState(state)
						const range = pluginState?.range || this.storage.activeRange

						if (range && range.from < range.to && range.to <= state.doc.content.size) {
							try {
								return DecorationSet.create(state.doc, [
									Decoration.inline(range.from, range.to, {
										class: 'ai-active-selection bg-primary/25 dark:bg-primary/30 rounded-sm outline outline-1 outline-primary/40 text-on-surface transition-all',
									}),
								])
							} catch {
								return DecorationSet.empty
							}
						}

						return DecorationSet.empty
					},
				},
			}),
		]
	},
})
