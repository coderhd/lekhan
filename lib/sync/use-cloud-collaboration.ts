'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { track } from '../analytics'
import type { CloudImagePolicy } from '../cloud/image-policy'
import { chunkedSocket } from './chunked-socket'
import { imageLimitCloseCode, pageSyncPausedCloseCode, payloadLimitCloseCode, syncProtocol, workspaceMediaLimitCloseCode } from './wire'
import { pageSyncPreference, type PageSyncPreference } from './preferences'

type PausedState = 'image-limit' | 'payload-limit' | 'workspace-media-limit'
type SyncState = 'opening' | 'live' | 'offline' | 'denied' | 'limit' | 'local-only' | PausedState
export interface CloudCollaboration {
  document: Y.Doc
  awareness: Awareness
  subject: string
}

export interface CloudStatus {
  session: CloudCollaboration | null
  status: SyncState
  writable: boolean
  imagePolicy?: CloudImagePolicy
  preference?: PageSyncPreference
}

const empty: CloudStatus = { session: null, status: 'opening', writable: false }
const cachedKey = 'last-checked-permission'
const policyKey = 'last-checked-image-policy'
const pauseKey = 'sync-pause'
const preferenceKey = 'sync-preference'

type Ticket = { ticket: string; endpoint: string; writable: boolean; planRestricted?: boolean; imagePolicy?: CloudImagePolicy;
  preference?: Exclude<PageSyncPreference, 'paused'> }

async function requestTicket(pageId: string, signal: AbortSignal) {
  const response = await fetch('/api/sync/session?' + new URLSearchParams({ pageId }), {
    cache: 'no-store', credentials: 'same-origin', signal,
  })
  if (response.status === 403 && (await response.json().catch(() => null))?.error === 'collaborator_limit') return 'limit' as const
  if ([401, 403, 404].includes(response.status)) return null
  if (!response.ok) throw new Error('Sync is temporarily unavailable.')
  const result = await response.json()
  if (result.preference === 'paused') return { preference: 'paused' as const, imagePolicy: 'free' as const }
  if (typeof result.ticket !== 'string' || typeof result.endpoint !== 'string' || typeof result.writable !== 'boolean') {
    throw new Error('Invalid sync session.')
  }
  return result as Ticket
}

export function useCloudCollaboration(pageId: string, subject: string, enabled: boolean) {
  const [state, setState] = useState<CloudStatus>(empty)
  const resume = useRef<() => void>(() => {})
  const preferenceChange = useRef<(enabled: boolean) => Promise<void>>(async () => { throw new Error('Sync is unavailable.') })
  const retrySync = useCallback(() => resume.current(), [])
  const changeSyncPreference = useCallback((enabled: boolean) => preferenceChange.current(enabled), [])

  useEffect(() => {
    if (!enabled) return
    const document = new Y.Doc()
    const awareness = new Awareness(document)
    const session: CloudCollaboration = { document, awareness, subject }
    const cache = new IndexeddbPersistence('lekhan:cloud:' + subject + ':' + pageId, document)
    const cancel = new AbortController()
    let provider: WebsocketProvider | null = null
    let disposeProvider: (() => void) | null = null
    let cachedPermission: 'read' | 'write' | undefined
    let imagePolicy: CloudImagePolicy | undefined
    let preference: PageSyncPreference | undefined
    let paused: PausedState | undefined
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let connecting = false
    let connectionRevision = 0
    let ready = false
    let reportedLimit = false

    function cachePreference(next: PageSyncPreference) {
      preference = next
      void cache.set(preferenceKey, next).catch(() => undefined)
    }

    function showLocalOnly() {
      if (!cancel.signal.aborted) {
        setState({ session: cachedPermission ? session : null, status: 'local-only', writable: cachedPermission === 'write', imagePolicy, preference: 'paused' })
      }
    }

    function showPaused() {
      if (paused && !cancel.signal.aborted) {
        setState({ session: cachedPermission ? session : null, status: paused, writable: cachedPermission === 'write', imagePolicy, preference })
      }
    }

    function retry() {
      if (cancel.signal.aborted || retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void connect()
      }, Math.min(15_000, 700 * 2 ** Math.min(retries++, 5)))
    }

    function offline() {
      if (cancel.signal.aborted) return
      if (preference === 'paused') { showLocalOnly(); return }
      if (paused) { showPaused(); return }
      setState({ session: cachedPermission ? session : null, status: 'offline', writable: cachedPermission === 'write', imagePolicy, preference })
      retry()
    }

    async function connect(retryingImage = false) {
      if (cancel.signal.aborted || connecting || provider?.wsconnected || provider?.wsconnecting) return
      connecting = true
      const revision = ++connectionRevision
      disposeProvider?.()
      disposeProvider = null
      provider = null
      try {
        const response = await requestTicket(pageId, AbortSignal.any([cancel.signal, AbortSignal.timeout(12_000)]))
        if (cancel.signal.aborted || revision !== connectionRevision) return
        if (!response || response === 'limit') {
          if (response === 'limit' && !reportedLimit) reportedLimit = track('paywall_hit', 'collaborators')
          cachedPermission = undefined
          preference = undefined
          await Promise.allSettled([cache.del(cachedKey), cache.del(pauseKey), cache.del(preferenceKey)])
          if (!cancel.signal.aborted && revision === connectionRevision) {
            setState({ session: null, status: response === 'limit' ? 'limit' : 'denied', writable: false })
          }
          return
        }
        if (response.imagePolicy === 'free' || response.imagePolicy === 'paid') {
          imagePolicy = response.imagePolicy
          void cache.set(policyKey, imagePolicy).catch(() => undefined)
        }
        if (pageSyncPreference(response.preference)) cachePreference(response.preference)
        if (response.preference === 'paused') { showLocalOnly(); return }
        const allowed = response.writable ? 'write' : 'read'
        if (response.planRestricted && !reportedLimit) reportedLimit = track('paywall_hit', 'sync')
        if (paused && response.writable && !retryingImage) {
          cachedPermission = allowed
          showPaused()
          return
        }
        if (!response.writable && cachedPermission === 'write') {
          setState({ session, status: 'opening', writable: false, imagePolicy, preference })
          cachedPermission = 'read'
        }
        const connection = new WebsocketProvider(response.endpoint, pageId, document, {
          connect: false,
          awareness,
          WebSocketPolyfill: chunkedSocket(WebSocket, response.writable),
          protocols: [syncProtocol, response.ticket],
          disableBc: true,
          shouldReconnect: () => false,
        })
        provider = connection
        const onClose = (event: CloseEvent | null) => {
          if (cancel.signal.aborted) return
          const remote = [...awareness.getStates().keys()].filter(id => id !== document.clientID)
          removeAwarenessStates(awareness, remote, connection)
          if (event?.code === pageSyncPausedCloseCode) {
            cachePreference('paused')
            showLocalOnly()
            return
          }
          if (event?.code === imageLimitCloseCode || event?.code === payloadLimitCloseCode || event?.code === workspaceMediaLimitCloseCode || event?.code === 1009) {
            paused = event.code === imageLimitCloseCode ? 'image-limit'
              : event.code === workspaceMediaLimitCloseCode ? 'workspace-media-limit' : 'payload-limit'
            if (event.reason === 'free' || event.reason === 'paid') imagePolicy = event.reason
            cachedPermission = allowed
            void cache.set(pauseKey, paused).catch(() => undefined)
            showPaused()
            return
          }
          if (event?.code === 4003) {
            cachedPermission = undefined
            void cache.del(cachedKey).catch(() => undefined)
          }
          offline()
        }
        const onSync = (synced: boolean) => {
          if (!synced || cancel.signal.aborted) return
          retries = 0
          cachedPermission = allowed
          paused = undefined
          void cache.del(pauseKey).catch(() => undefined)
          setState({ session, status: 'live', writable: response.writable, imagePolicy, preference })
          void cache.set(cachedKey, allowed).catch(() => undefined)
        }
        connection.on('connection-close', onClose)
        connection.on('sync', onSync)
        disposeProvider = () => {
          connection.off('connection-close', onClose)
          connection.off('sync', onSync)
          connection.destroy()
        }
        connection.connect()
      } catch {
        if (revision === connectionRevision) offline()
      } finally {
        if (revision === connectionRevision) connecting = false
      }
    }

    function onOnline() {
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = undefined
      if (ready) void connect()
    }

    window.addEventListener('online', onOnline)
    resume.current = () => { void connect(true) }
    function refreshPaused() {
      if (ready && preference === 'paused' && navigator.onLine) void connect()
    }
    window.addEventListener('focus', refreshPaused)
    const pollPreference = setInterval(refreshPaused, 20_000)
    preferenceChange.current = async next => {
      const response = await fetch('/api/sync/preferences?' + new URLSearchParams({ pageId }), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }), signal: cancel.signal,
      })
      if (response.status === 409) throw new Error('The current sharing or workspace plan keeps this page synced.')
      if (!response.ok) throw new Error('Could not change cloud sync. Try again.')
      const result = await response.json()
      if (cancel.signal.aborted) return
      if (!pageSyncPreference(result.preference)) throw new Error('Could not change cloud sync. Try again.')
      connectionRevision++
      connecting = false
      disposeProvider?.()
      disposeProvider = null
      provider = null
      cachePreference(result.preference)
      if (result.preference === 'paused') showLocalOnly()
      else void connect(true)
    }
    void cache.whenSynced.then(async () => {
      if (cancel.signal.aborted) return
      const [saved, policy, savedPause, savedPreference] = await Promise.all([
        cache.get(cachedKey), cache.get(policyKey), cache.get(pauseKey), cache.get(preferenceKey),
      ])
      if (saved === 'read' || saved === 'write') cachedPermission = saved
      if (policy === 'free' || policy === 'paid') imagePolicy = policy
      if (savedPause === 'image-limit' || savedPause === 'payload-limit' || savedPause === 'workspace-media-limit') paused = savedPause
      if (pageSyncPreference(savedPreference)) preference = savedPreference
      ready = true
      if (!navigator.onLine) offline()
      else void connect()
    }).catch(() => {
      if (!cancel.signal.aborted) void connect()
    })

    return () => {
      cancel.abort()
      resume.current = () => {}
      preferenceChange.current = async () => { throw new Error('Sync is unavailable.') }
      clearInterval(pollPreference)
      if (retryTimer) clearTimeout(retryTimer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', refreshPaused)
      disposeProvider?.()
      awareness.destroy()
      // Y.Doc destroy also releases the IndexedDB provider and its queued listeners.
      document.destroy()
    }
  }, [enabled, pageId, subject])

  return { ...state, retrySync, changeSyncPreference }
}
