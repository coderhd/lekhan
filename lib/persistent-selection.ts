import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const PersistentSelection = Extension.create({
	name: 'persistentSelection',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('persistentSelection'),
				props: {
					decorations(state) {
						if (!state || !state.doc || !state.selection) {
							return DecorationSet.empty
						}
						const { selection, doc } = state
						if (!selection.empty) {
							const { from, to } = selection
							return DecorationSet.create(doc, [
								Decoration.inline(from, to, {
									class: 'ai-active-selection bg-primary/25 dark:bg-primary/30 rounded-sm outline outline-1 outline-primary/40 text-on-surface transition-all',
								}),
							])
						}
						return DecorationSet.empty
					},
				},
			}),
		]
	},
})
