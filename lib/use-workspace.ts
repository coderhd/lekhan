'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadWorkspace, saveWorkspace, WorkspaceConflictError, type WorkspaceStorage } from './storage'
import { starterWorkspace } from './starter-workspace'
import type { Workspace } from './types'
import { analyticsAllowed, track } from './analytics'

export type SaveStatus = 'loading' | 'saving' | 'saved' | 'error' | 'conflict'

export function useWorkspace(scope = 'personal', storage?: WorkspaceStorage) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [status, setStatus] = useState<SaveStatus>('loading')
  const current = useRef<Workspace | null>(null)
  const revision = useRef(0)
  const persisted = useRef<Workspace | null>(null)
  const busy = useRef(false)
  const conflict = useRef(false)
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveCallbacks = useRef<(() => void)[]>([])
  const durableChanges = useRef<{ resolve: () => void; reject: (failure: unknown) => void }[]>([])
  const load = useCallback(() => storage ? storage.load() : loadWorkspace(scope), [scope, storage])

  const flush = useCallback(async () => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current)
      flushTimer.current = undefined
    }
    if (busy.current || conflict.current) return
    busy.current = true
    try {
      while (current.current && current.current !== persisted.current) {
        const snapshot: Workspace = current.current
        const pendingCallbacks = saveCallbacks.current.length
        const pendingReceipts = durableChanges.current.length
        setStatus(currentStatus => currentStatus === 'saving' ? currentStatus : 'saving')
        const saved = await (storage
          ? storage.save(snapshot, revision.current, persisted.current)
          : saveWorkspace(snapshot, revision.current, scope, persisted.current?.pages))
        revision.current = saved.revision
        persisted.current = snapshot
        for (const receipt of durableChanges.current.splice(0, pendingReceipts)) receipt.resolve()
        for (const saved of saveCallbacks.current.splice(0, pendingCallbacks)) saved()
      }
      setStatus(currentStatus => currentStatus === 'saved' ? currentStatus : 'saved')
    } catch (error) {
      for (const receipt of durableChanges.current.splice(0)) receipt.reject(error)
      conflict.current = error instanceof WorkspaceConflictError
      setStatus(conflict.current ? 'conflict' : 'error')
    } finally {
      busy.current = false
    }
  }, [scope, storage])

  const hydrate = useCallback((saved?: Workspace) => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current)
      flushTimer.current = undefined
    }
    const initial = saved ?? starterWorkspace()
    persisted.current = saved ?? null
    saveCallbacks.current = []
    for (const receipt of durableChanges.current.splice(0)) receipt.reject(new Error('The local notebook was reloaded.'))
    current.current = initial
    revision.current = initial.revision
    conflict.current = false
    setWorkspace(initial)
    if (saved) setStatus('saved')
    else {
      if (analyticsAllowed()) saveCallbacks.current.push(() => track('workspace_created', 'local'))
      void flush()
    }
  }, [flush])

  useEffect(() => {
    const controller = new AbortController()
    void load().then(saved => {
      if (!controller.signal.aborted) hydrate(saved)
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('error')
    })
    return () => controller.abort()
  }, [hydrate, load])

  useEffect(() => {
    if (!storage?.hasChanges || status !== 'saved') return
    let stopped = false
    let checking = false
    const check = async () => {
      if (checking || busy.current) return
      checking = true
      const before = current.current
      try {
        if (!await storage.hasChanges?.(persisted.current) || stopped || busy.current || current.current !== before) return
        const saved = await load()
        if (!stopped && saved && !busy.current && current.current === before) hydrate(saved)
      } catch {
        if (!stopped && current.current === before && !busy.current) setStatus('error')
      } finally {
        checking = false
      }
    }
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check() }, 1000)
    window.addEventListener('focus', check)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [storage, status, hydrate, load, workspace])

  useEffect(() => {
    if (!workspace || status === 'saved' || status === 'loading') return
    function confirmUnsavedChanges(event: BeforeUnloadEvent) {
      if (current.current === persisted.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    function flushPending() {
      if (current.current !== persisted.current) void flush()
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') flushPending()
    }
    window.addEventListener('beforeunload', confirmUnsavedChanges)
    window.addEventListener('pagehide', flushPending)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', confirmUnsavedChanges)
      window.removeEventListener('pagehide', flushPending)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [flush, status, workspace])

  useEffect(() => () => {
    if (flushTimer.current) clearTimeout(flushTimer.current)
  }, [])

  const change = useCallback((update: (previous: Workspace) => Workspace, onSaved?: () => void) => {
    const previous = current.current
    if (!previous) return
    const updated = update(previous)
    if (updated === previous) return
    const next = storage?.prepareChange?.(previous, updated, persisted.current) ?? updated
    current.current = next
    if (onSaved && analyticsAllowed()) saveCallbacks.current.push(onSaved)
    const contentOnly = next.activePageId === previous.activePageId && next.pages.length === previous.pages.length
    if (contentOnly) {
      setStatus(currentStatus => currentStatus === 'saving' ? currentStatus : 'saving')
      setWorkspace(next)
      if (flushTimer.current) clearTimeout(flushTimer.current)
      flushTimer.current = setTimeout(() => {
        flushTimer.current = undefined
        void flush()
      }, 120)
    } else {
      setWorkspace(next)
      void flush()
    }
  }, [flush, storage])

  const reload = useCallback(async () => {
    setStatus('loading')
    try {
      hydrate(await load())
    } catch {
      setStatus('error')
    }
  }, [hydrate, load])

  const persistChange = useCallback((update: (previous: Workspace) => Workspace) => new Promise<void>((resolve, reject) => {
    if (!current.current || conflict.current) { reject(new Error('Save the current notebook before syncing this page.')); return }
    const previous = current.current
    const updated = update(previous)
    if (updated === previous) { reject(new Error('The local page changed. Open it again and retry.')); return }
    const next = storage?.prepareChange?.(previous, updated, persisted.current) ?? updated
    durableChanges.current.push({ resolve, reject })
    current.current = next
    setWorkspace(next)
    void flush()
  }), [flush, storage])

  return {
    workspace,
    status,
    change,
    persistChange,
    retry: workspace ? flush : reload,
    reload,
  }
}
