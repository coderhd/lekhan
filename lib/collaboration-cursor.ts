import { Extension } from '@tiptap/core'
import { yCursorPlugin, defaultSelectionBuilder } from '@tiptap/y-tiptap'

export interface CollaborationCursorOptions {
	provider: any
	user: Record<string, any>
	render?: (user: Record<string, any>) => HTMLElement
	selectionRender?: (user: Record<string, any>) => any
}

export const CollaborationCursor = Extension.create<CollaborationCursorOptions>({
	name: 'collaborationCursor',

	addOptions() {
		return {
			provider: null,
			user: {
				name: null,
				color: null,
			},
			render: (user: Record<string, any>) => {
				const cursor = document.createElement('span')
				cursor.classList.add('collaboration-cursor__caret')
				cursor.setAttribute('style', `border-color: ${user.color}`)

				const label = document.createElement('div')
				label.classList.add('collaboration-cursor__label')
				label.setAttribute('style', `background-color: ${user.color}`)
				label.insertBefore(document.createTextNode(user.name || 'Anonymous'), null)
				cursor.insertBefore(label, null)

				return cursor
			},
			selectionRender: defaultSelectionBuilder,
		}
	},

	addStorage() {
		return {
			users: [],
			awarenessListener: null as (() => void) | null,
			awarenessInstance: null as any,
		}
	},

	onDestroy() {
		if (this.storage.awarenessInstance && this.storage.awarenessListener) {
			this.storage.awarenessInstance.off('update', this.storage.awarenessListener)
			this.storage.awarenessListener = null
			this.storage.awarenessInstance = null
		}
	},

	addCommands() {
		return {
			updateUser: (attributes: Record<string, any>) => ({ dispatch }: { dispatch?: boolean }) => {
				if (dispatch) {
					this.options.user = attributes
					if (this.options.provider?.awareness) {
						this.options.provider.awareness.setLocalStateField('user', this.options.user)
					}
				}
				return true
			},
		} as any
	},

	addProseMirrorPlugins() {
		const awareness = this.options.provider?.awareness
		if (!awareness) {
			return []
		}

		awareness.setLocalStateField('user', this.options.user)

		const getAwarenessUsers = () => {
			const states = awareness.getStates()
			const result: any[] = []
			if (states && typeof states.forEach === 'function') {
				states.forEach((val: any, key: number) => {
					result.push({
						clientId: key,
						...val?.user,
					})
				})
			}
			return result
		}

		this.storage.users = getAwarenessUsers()

		const updateListener = () => {
			this.storage.users = getAwarenessUsers()
		}
		this.storage.awarenessListener = updateListener
		this.storage.awarenessInstance = awareness
		awareness.on('update', updateListener)

		return [
			yCursorPlugin(
				awareness,
				{
					cursorBuilder: this.options.render,
					selectionBuilder: this.options.selectionRender,
				}
			),
		]
	},
})
