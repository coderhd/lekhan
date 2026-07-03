import { useEffect, useState } from 'react'
import * as Y from 'yjs'

export interface CollabUser {
	id: string
	name: string
	color: string
}

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

	useEffect(() => {
		if (typeof window === 'undefined') {
			return
		}

		// Dynamically import client-only providers to prevent SSR issues
		Promise.all([
			import('y-websocket'),
			import('y-indexeddb'),
		]).then(([{ WebsocketProvider }, { IndexeddbPersistence }]) => {
			const doc = new Y.Doc()
			setYdoc(doc)

			// 1. Initialize IndexedDB local persistence
			const indexeddbProvider = new IndexeddbPersistence(documentId, doc)
			indexeddbProvider.on('synced', () => {
				console.log('[IndexedDB] Local document loaded successfully')
			})

			// 2. Initialize WebSocket remote provider
			const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080'
			const wsProvider = new WebsocketProvider(wsUrl, documentId, doc, {
				params: { token, documentId },
				connect: true,
			})

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
					.map((state: any) => state.user)
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

			return () => {
				doc.destroy()
				wsProvider.destroy()
				indexeddbProvider.destroy()
			}
		})
	}, [documentId, token, user.name, user.color])

	return {
		ydoc,
		isConnected,
		isSynced,
		activeUsers,
		hasUnsyncedChanges: isDirty && (!isConnected || !isSynced),
	}
}
