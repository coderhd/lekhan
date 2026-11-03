import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import type { IndexeddbPersistence } from 'y-indexeddb'

import { CollabUser } from '@/types'
import { hasPendingLocalEdits, setPendingLocalEdits } from '@/lib/local-edits-marker'

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

/**
 * Presence lists are tiny (a handful of collaborators), so an explicit
 * field-by-field comparison is cheaper than serialising, and it keeps the
 * `activeUsers` reference stable when only cursor positions changed.
 */
function sameCollabUsers (a: CollabUser[], b: CollabUser[]) {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i].id !== b[i].id || a[i].name !== b[i].name || a[i].color !== b[i].color) {
			return false
		}
	}
	return true
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

		// A reload must not hide edits that are still only on this device.
		setIsDirty(hasPendingLocalEdits(documentId))
		// The persisted marker can only be cleared once BOTH the local replica
		// has restored its stored edits and the hub handshake has completed.
		// Clearing on hub sync alone could drop the marker before IndexedDB
		// applies the pending edits, briefly showing "Offline" for work that
		// is still waiting to sync.
		let isLocalRestored = false
		let isHubSynced = false
		const clearPendingMarkerIfRestored = () => {
			if (!isLocalRestored || !isHubSynced) {
				return
			}
			setIsDirty(false)
			setPendingLocalEdits(documentId, false)
		}
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
				isLocalRestored = true
				clearPendingMarkerIfRestored()
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
					isHubSynced = false
					setIsSynced(false)
				}
				evaluateConnectionState()
			})

			wsProvider.on('sync', (isSyncedState: boolean) => {
				setIsSynced(isSyncedState)
				isHubSynced = isSyncedState
				clearPendingMarkerIfRestored()
			})

			// 4. Configure awareness (presence)
			const { awareness } = wsProvider
			awareness.setLocalStateField('user', {
				name: user.name,
				color: user.color,
			})

			// Awareness fires on *every* local cursor move — `yCursorPlugin`
			// rewrites the local `cursor` field on each view update, which
			// during typing is once per keystroke. Rebuilding the
			// `activeUsers` array unconditionally therefore re-rendered the
			// entire editor workspace (header + toolbar + every dropdown) on
			// every character typed (SIL-230 / #144: 7,285 React renders over
			// a 38-char burst). Only publish a new array when the presence
			// list actually differs; cursor-only churn is not presence.
			awareness.on('change', () => {
				const states = Array.from(awareness.getStates().values())
				const users = states
					.map((state: { user?: CollabUser }) => state.user)
					.filter(Boolean) as CollabUser[]
				setActiveUsers(prev => sameCollabUsers(prev, users) ? prev : users)
			})

			// 5. Track local changes (dirty flag)
			doc.on('update', (_update, origin) => {
				// If change was made by the local user, set dirty flag
				if (origin !== wsProvider && origin !== indexeddbProvider) {
					// y-websocket flushes local updates synchronously over an
					// open, synced socket. Only call an update "local only"
					// when it could not have reached the hub.
					const reachedHub = Boolean(wsProvider?.wsconnected && wsProvider?.synced)
					setIsDirty(!reachedHub)
					setPendingLocalEdits(documentId, !reachedHub)
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
			setIsDirty(false)
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
