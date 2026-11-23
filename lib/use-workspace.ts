'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadWorkspace, saveWorkspace, WorkspaceConflictError } from './storage'
import { starterWorkspace } from './starter-workspace'
import type { Workspace } from './types'
import { analyticsAllowed, track } from './analytics'

export type SaveStatus = 'loading' | 'saving' | 'saved' | 'error' | 'conflict'

export function useWorkspace(scope = 'personal') {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [status, setStatus] = useState<SaveStatus>('loading')
  const current = useRef<Workspace | null>(null)
  const revision = useRef(0)
  const persisted = useRef<Workspace | null>(null)
  const busy = useRef(false)
  const conflict = useRef(false)
  const saveCallbacks = useRef<(() => void)[]>([])
  const durableChanges = useRef<{ resolve: () => void; reject: (failure: unknown) => void }[]>([])

  const flush = useCallback(async () => {
    if (busy.current || conflict.current) return
    busy.current = true
    try {
      while (current.current && current.current !== persisted.current) {
        const snapshot: Workspace = current.current
        const pendingCallbacks = saveCallbacks.current.length
        const pendingReceipts = durableChanges.current.length
        setStatus('saving')
        const saved = await saveWorkspace(snapshot, revision.current, scope)
        revision.current = saved.revision
        persisted.current = snapshot
        for (const receipt of durableChanges.current.splice(0, pendingReceipts)) receipt.resolve()
        for (const saved of saveCallbacks.current.splice(0, pendingCallbacks)) saved()
      }
      setStatus('saved')
    } catch (error) {
      for (const receipt of durableChanges.current.splice(0)) receipt.reject(error)
      conflict.current = error instanceof WorkspaceConflictError
      setStatus(conflict.current ? 'conflict' : 'error')
    } finally {
      busy.current = false
    }
  }, [scope])

  const hydrate = useCallback((saved?: Workspace) => {
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
    void loadWorkspace(scope).then(saved => {
      if (!controller.signal.aborted) hydrate(saved)
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('error')
    })
    return () => controller.abort()
  }, [hydrate, scope])

  useEffect(() => {
    if (!workspace || status === 'saved' || status === 'loading') return
    function confirmUnsavedChanges(event: BeforeUnloadEvent) {
      if (current.current === persisted.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', confirmUnsavedChanges)
    return () => window.removeEventListener('beforeunload', confirmUnsavedChanges)
  }, [status, workspace])

  const change = useCallback((update: (previous: Workspace) => Workspace, onSaved?: () => void) => {
    if (!current.current) return
    const next = update(current.current)
    if (next === current.current) return
    current.current = next
    if (onSaved && analyticsAllowed()) saveCallbacks.current.push(onSaved)
    setWorkspace(next)
    void flush()
  }, [flush])

  const reload = useCallback(async () => {
    setStatus('loading')
    try {
      hydrate(await loadWorkspace(scope))
    } catch {
      setStatus('error')
    }
  }, [hydrate, scope])

  const persistChange = useCallback((update: (previous: Workspace) => Workspace) => new Promise<void>((resolve, reject) => {
    if (!current.current || conflict.current) { reject(new Error('Save the current notebook before syncing this page.')); return }
    const next = update(current.current)
    if (next === current.current) { reject(new Error('The local page changed. Open it again and retry.')); return }
    durableChanges.current.push({ resolve, reject })
    current.current = next
    setWorkspace(next)
    void flush()
  }), [flush])

  return {
    workspace,
    status,
    change,
    persistChange,
    retry: workspace ? flush : reload,
    reload,
  }
}
