'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { track } from '../analytics'
import type { CloudImagePolicy } from '../cloud/image-policy'
import { chunkedSocket } from './chunked-socket'
import { imageLimitCloseCode, payloadLimitCloseCode, syncProtocol } from './wire'

type PausedState = 'image-limit' | 'payload-limit'
type SyncState = 'opening' | 'live' | 'offline' | 'denied' | 'limit' | PausedState
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
}

const empty: CloudStatus = { session: null, status: 'opening', writable: false }
const cachedKey = 'last-checked-permission'
const policyKey = 'last-checked-image-policy'
const pauseKey = 'sync-pause'

async function requestTicket(pageId: string, signal: AbortSignal) {
  const response = await fetch('/api/sync/session?' + new URLSearchParams({ pageId }), {
    cache: 'no-store', credentials: 'same-origin', signal,
  })
  if (response.status === 403 && (await response.json().catch(() => null))?.error === 'collaborator_limit') return 'limit' as const
  if ([401, 403, 404].includes(response.status)) return null
  if (!response.ok) throw new Error('Sync is temporarily unavailable.')
  const result = await response.json()
  if (typeof result.ticket !== 'string' || typeof result.endpoint !== 'string' || typeof result.writable !== 'boolean') {
    throw new Error('Invalid sync session.')
  }
  return result as { ticket: string; endpoint: string; writable: boolean; planRestricted?: boolean; imagePolicy?: CloudImagePolicy }
}

export function useCloudCollaboration(pageId: string, subject: string, enabled: boolean) {
  const [state, setState] = useState<CloudStatus>(empty)
  const resume = useRef<() => void>(() => {})
  const retrySync = useCallback(() => resume.current(), [])

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
    let paused: PausedState | undefined
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let connecting = false
    let ready = false
    let reportedLimit = false

    function showPaused() {
      if (paused && !cancel.signal.aborted) {
        setState({ session: cachedPermission ? session : null, status: paused, writable: cachedPermission === 'write', imagePolicy })
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
      if (paused) { showPaused(); return }
      setState({ session: cachedPermission ? session : null, status: 'offline', writable: cachedPermission === 'write', imagePolicy })
      retry()
    }

    async function connect(retryingImage = false) {
      if (cancel.signal.aborted || connecting || provider?.wsconnected || provider?.wsconnecting) return
      connecting = true
      disposeProvider?.()
      disposeProvider = null
      provider = null
      try {
        const response = await requestTicket(pageId, AbortSignal.any([cancel.signal, AbortSignal.timeout(12_000)]))
        if (cancel.signal.aborted) return
        if (!response || response === 'limit') {
          if (response === 'limit' && !reportedLimit) reportedLimit = track('paywall_hit', 'collaborators')
          cachedPermission = undefined
          await Promise.allSettled([cache.del(cachedKey), cache.del(pauseKey)])
          if (!cancel.signal.aborted) setState({ session: null, status: response === 'limit' ? 'limit' : 'denied', writable: false })
          return
        }
        const allowed = response.writable ? 'write' : 'read'
        if (response.imagePolicy === 'free' || response.imagePolicy === 'paid') {
          imagePolicy = response.imagePolicy
          void cache.set(policyKey, imagePolicy).catch(() => undefined)
        }
        if (response.planRestricted && !reportedLimit) reportedLimit = track('paywall_hit', 'sync')
        if (paused && response.writable && !retryingImage) {
          cachedPermission = allowed
          showPaused()
          return
        }
        if (!response.writable && cachedPermission === 'write') {
          setState({ session, status: 'opening', writable: false, imagePolicy })
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
          if (event?.code === imageLimitCloseCode || event?.code === payloadLimitCloseCode || event?.code === 1009) {
            paused = event.code === imageLimitCloseCode ? 'image-limit' : 'payload-limit'
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
          setState({ session, status: 'live', writable: response.writable, imagePolicy })
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
        offline()
      } finally {
        connecting = false
      }
    }

    function onOnline() {
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = undefined
      if (ready) void connect()
    }

    window.addEventListener('online', onOnline)
    resume.current = () => { void connect(true) }
    void cache.whenSynced.then(async () => {
      if (cancel.signal.aborted) return
      const [saved, policy, savedPause] = await Promise.all([cache.get(cachedKey), cache.get(policyKey), cache.get(pauseKey)])
      if (saved === 'read' || saved === 'write') cachedPermission = saved
      if (policy === 'free' || policy === 'paid') imagePolicy = policy
      if (savedPause === 'image-limit' || savedPause === 'payload-limit') paused = savedPause
      ready = true
      if (!navigator.onLine) offline()
      else void connect()
    }).catch(() => {
      if (!cancel.signal.aborted) void connect()
    })

    return () => {
      cancel.abort()
      resume.current = () => {}
      if (retryTimer) clearTimeout(retryTimer)
      window.removeEventListener('online', onOnline)
      disposeProvider?.()
      awareness.destroy()
      // Y.Doc destroy also releases the IndexedDB provider and its queued listeners.
      document.destroy()
    }
  }, [enabled, pageId, subject])

  return { ...state, retrySync }
}
