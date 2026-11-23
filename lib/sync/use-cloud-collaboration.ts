'use client'

import { useEffect, useState } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { track } from '../analytics'
import { syncProtocol } from './wire'

type SyncState = 'opening' | 'live' | 'offline' | 'denied' | 'limit'
export interface CloudCollaboration {
  document: Y.Doc
  awareness: Awareness
  subject: string
}

export interface CloudStatus {
  session: CloudCollaboration | null
  status: SyncState
  writable: boolean
}

const empty: CloudStatus = { session: null, status: 'opening', writable: false }
const cachedKey = 'last-checked-permission'

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
  return result as { ticket: string; endpoint: string; writable: boolean; planRestricted?: boolean }
}

export function useCloudCollaboration(pageId: string, subject: string, enabled: boolean): CloudStatus {
  const [state, setState] = useState<CloudStatus>(empty)

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
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let connecting = false
    let ready = false
    let reportedLimit = false

    function retry() {
      if (cancel.signal.aborted || retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void connect()
      }, Math.min(15_000, 700 * 2 ** Math.min(retries++, 5)))
    }

    function offline() {
      if (cancel.signal.aborted) return
      setState({ session: cachedPermission ? session : null, status: 'offline', writable: cachedPermission === 'write' })
      retry()
    }

    async function connect() {
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
          await cache.del(cachedKey).catch(() => undefined)
          if (!cancel.signal.aborted) setState({ session: null, status: response === 'limit' ? 'limit' : 'denied', writable: false })
          return
        }
        const allowed = response.writable ? 'write' : 'read'
        if (response.planRestricted && !reportedLimit) reportedLimit = track('paywall_hit', 'sync')
        if (!response.writable && cachedPermission === 'write') {
          setState({ session, status: 'opening', writable: false })
          cachedPermission = 'read'
        }
        const connection = new WebsocketProvider(response.endpoint, pageId, document, {
          connect: false,
          awareness,
          protocols: [syncProtocol, response.ticket],
          disableBc: true,
          shouldReconnect: () => false,
        })
        provider = connection
        const onClose = (event: CloseEvent | null) => {
          if (cancel.signal.aborted) return
          const remote = [...awareness.getStates().keys()].filter(id => id !== document.clientID)
          removeAwarenessStates(awareness, remote, connection)
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
          setState({ session, status: 'live', writable: response.writable })
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
    void cache.whenSynced.then(async () => {
      if (cancel.signal.aborted) return
      const saved = await cache.get(cachedKey)
      if (saved === 'read' || saved === 'write') cachedPermission = saved
      ready = true
      if (!navigator.onLine) offline()
      else void connect()
    }).catch(() => {
      if (!cancel.signal.aborted) void connect()
    })

    return () => {
      cancel.abort()
      if (retryTimer) clearTimeout(retryTimer)
      window.removeEventListener('online', onOnline)
      disposeProvider?.()
      awareness.destroy()
      // Y.Doc destroy also releases the IndexedDB provider and its queued listeners.
      document.destroy()
    }
  }, [enabled, pageId, subject])

  return state
}
