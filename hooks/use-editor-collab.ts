import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import type { IndexeddbPersistence } from 'y-indexeddb'

import { CollabUser } from '@/types'

export function useEditorCollab (
	documentId: string,
	token: string,
	user: CollabUser
) {
	const [ydoc, setYdoc] = useState<Y.Doc | null>(null)
	const [isConnected, setIsConnected] = useState(false)
	const [isSynced, setIsSynced] = useState(false)
	const [activeUsers, setActiveUsers] = useState<CollabUser[]>([])
	const [isDirty, setIsDirty] = useState(false)
	const [provider, setProvider] = useState<WebsocketProvider | null>(null)

	useEffect(() => {
		if (typeof window === 'undefined') {
			return
		}

		let isCancelled = false
		let doc: Y.Doc | null = null
		let wsProvider: WebsocketProvider | null = null
		let indexeddbProvider: IndexeddbPersistence | null = null

		Promise.all([
			import('y-websocket'),
			import('y-indexeddb'),
		]).then(([{ WebsocketProvider }, { IndexeddbPersistence }]) => {
			if (isCancelled) {
				return
			}
			doc = new Y.Doc()
			setYdoc(doc)

			// 1. Initialize IndexedDB local persistence
			indexeddbProvider = new IndexeddbPersistence(documentId, doc)
			indexeddbProvider.on('synced', () => {
				// Initial sync completed
			})

			// 2. Initialize WebSocket remote provider
			const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080'
			wsProvider = new WebsocketProvider(wsUrl, documentId, doc, {
				params: { token, documentId },
				connect: true,
			})
			setProvider(wsProvider)

			// 3. Track connection status
			wsProvider.on('status', ({ status }: { status: string }) => {
				const connected = status === 'connected'
				setIsConnected(connected)
				if (!connected) {
					setIsSynced(false)
				}
			})

			wsProvider.on('sync', (isSyncedState: boolean) => {
				setIsSynced(isSyncedState)
				if (isSyncedState) {
					setIsDirty(false)
				}
			})

			// 4. Configure awareness (presence)
			const { awareness } = wsProvider
			awareness.setLocalStateField('user', {
				name: user.name,
				color: user.color,
			})

			awareness.on('change', () => {
				const states = Array.from(awareness.getStates().values())
				const users = states
					.map((state: { user?: CollabUser }) => state.user)
					.filter(Boolean) as CollabUser[]
				setActiveUsers(users)
			})

			// 5. Track local changes (dirty flag)
			doc.on('update', (update, origin) => {
				// If change was made by the local user, set dirty flag
				if (origin !== wsProvider && origin !== indexeddbProvider) {
					setIsDirty(true)
				}
			})
		})

		return () => {
			isCancelled = true
			if (doc) doc.destroy()
			if (wsProvider) wsProvider.destroy()
			if (indexeddbProvider) indexeddbProvider.destroy()
			
			// Clear states to prevent stale instances during remount
			setYdoc(null)
			setProvider(null)
			setIsConnected(false)
			setIsSynced(false)
		}
	}, [documentId, token, user.name, user.color])

	return {
		ydoc,
		isConnected,
		isSynced,
		activeUsers,
		hasUnsyncedChanges: isDirty && (!isConnected || !isSynced),
		provider,
	}
}
