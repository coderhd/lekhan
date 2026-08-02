import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import type { IndexeddbPersistence } from 'y-indexeddb'

import { CollabUser } from '@/types'

export type ConnectionState = 'connected' | 'connecting' | 'offline'

type WsStatus = 'connecting' | 'connected' | 'disconnected'

// The sync server runs on Render's free tier, which spins the process down
// after inactivity and takes roughly 50s to cold-start back up (per
// Render's own docs). During that window the browser has a perfectly good
// internet connection — the collaboration *server* is just waking up.
// Flashing a red "Offline" indicator for up to 50s on every session start
// would be a false alarm, so the UI stays optimistic ("connecting") for a
// grace period before it treats this as a genuine disconnect.
const RECONNECT_GRACE_PERIOD_MS = 60_000

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
	const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
	const [isLocalSynced, setIsLocalSynced] = useState(false)

	useEffect(() => {
		if (typeof window === 'undefined') {
			return
		}

		let isCancelled = false
		let doc: Y.Doc | null = null
		let wsProvider: WebsocketProvider | null = null
		let indexeddbProvider: IndexeddbPersistence | null = null
		let graceTimer: ReturnType<typeof setTimeout> | null = null
		let browserOnline = navigator.onLine
		let lastWsStatus: WsStatus = 'connecting'
		// True once the grace period has elapsed without a successful
		// connection, for the *current* attempt. Reset whenever we get a
		// fresh reason to be optimistic again (websocket connects, or the
		// browser regains network after being offline) so a single sustained
		// failure doesn't permanently block recovery, while still avoiding
		// flicker back to "connecting" on every retry pulse while genuinely
		// stuck offline.
		let hasExceededGracePeriod = false

		const clearGraceTimer = () => {
			if (graceTimer) {
				clearTimeout(graceTimer)
				graceTimer = null
			}
		}

		// The single source of truth for what the UI should show. Called
		// whenever either the websocket status or the browser's own
		// online/offline signal changes.
		const evaluateConnectionState = () => {
			if (!browserOnline) {
				// No point being optimistic if the device itself has no
				// network — this is unambiguous, so skip the grace period.
				clearGraceTimer()
				hasExceededGracePeriod = false
				setConnectionState('offline')
				return
			}

			if (lastWsStatus === 'connected') {
				clearGraceTimer()
				hasExceededGracePeriod = false
				setConnectionState('connected')
				return
			}

			if (hasExceededGracePeriod) {
				// Already gave this attempt its full grace period; don't
				// flicker back to "connecting" on every subsequent retry
				// pulse while the server is still genuinely unreachable.
				setConnectionState('offline')
				return
			}

			// Browser is online but the websocket isn't connected yet — this
			// is exactly the Render cold-start scenario (or a brief reconnect
			// blip). Stay optimistic until the grace period elapses.
			setConnectionState('connecting')
			if (!graceTimer) {
				graceTimer = setTimeout(() => {
					graceTimer = null
					hasExceededGracePeriod = true
					setConnectionState('offline')
				}, RECONNECT_GRACE_PERIOD_MS)
			}
		}

		const handleBrowserOnline = () => {
			browserOnline = true
			// Network just came back — worth a fresh optimistic attempt
			// rather than continuing to show "offline" from before.
			hasExceededGracePeriod = false
			evaluateConnectionState()
		}
		const handleBrowserOffline = () => {
			browserOnline = false
			evaluateConnectionState()
		}

		window.addEventListener('online', handleBrowserOnline)
		window.addEventListener('offline', handleBrowserOffline)

		Promise.all([
			import('y-websocket'),
			import('y-indexeddb'),
		]).then(([{ WebsocketProvider }, { IndexeddbPersistence }]) => {
			if (isCancelled) {
				return
			}
			doc = new Y.Doc()

			// 1. Initialize IndexedDB local persistence
			indexeddbProvider = new IndexeddbPersistence(documentId, doc)
			indexeddbProvider.on('synced', () => {
				setIsLocalSynced(true)
			})

			// 2. Initialize WebSocket remote provider
			const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080'
			wsProvider = new WebsocketProvider(wsUrl, documentId, doc, {
				params: { token, documentId },
				connect: true,
			})

			setYdoc(doc)
			setProvider(wsProvider)

			// 3. Track connection status
			wsProvider.on('status', ({ status }: { status: WsStatus }) => {
				lastWsStatus = status
				const connected = status === 'connected'
				setIsConnected(connected)
				if (!connected) {
					setIsSynced(false)
				}
				evaluateConnectionState()
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
			doc.on('update', (_update, origin) => {
				// If change was made by the local user, set dirty flag
				if (origin !== wsProvider && origin !== indexeddbProvider) {
					setIsDirty(true)
				}
			})
		})

		return () => {
			isCancelled = true
			clearGraceTimer()
			window.removeEventListener('online', handleBrowserOnline)
			window.removeEventListener('offline', handleBrowserOffline)
			if (doc) doc.destroy()
			if (wsProvider) wsProvider.destroy()
			if (indexeddbProvider) indexeddbProvider.destroy()

			// Clear states to prevent stale instances during remount
			setYdoc(null)
			setProvider(null)
			setIsConnected(false)
			setIsSynced(false)
			setIsLocalSynced(false)
			setConnectionState('connecting')
		}
	}, [documentId, token, user.name, user.color])

	return {
		ydoc,
		isConnected,
		isSynced,
		connectionState,
		isOffline: connectionState === 'offline',
		activeUsers,
		hasUnsyncedChanges: isDirty && (!isConnected || !isSynced),
		provider,
		isLocalSynced,
	}
}
