import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createPage } from '../lib/workspace'
import { loadWorkspace, saveWorkspace, WorkspaceConflictError } from '../lib/storage'

describe('workspace persistence', () => {
  it('persists a durable snapshot and accepts only one writer at a given revision', async () => {
    expect(await loadWorkspace()).toBeUndefined()

    const initial = createPage({ pages: [], activePageId: null, revision: 0 }, { title: 'Initial' })
    const stored = await saveWorkspace(initial, 0)
    expect(stored.revision).toBe(1)
    expect(await loadWorkspace()).toEqual(stored)

    const first = createPage(stored, { title: 'First edit' })
    const second = createPage(stored, { title: 'Second edit' })
    const outcomes = await Promise.allSettled([
      saveWorkspace(first, stored.revision),
      saveWorkspace(second, stored.revision),
    ])
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(WorkspaceConflictError)
    expect(await loadWorkspace()).toMatchObject({ revision: 2 })
    expect((await loadWorkspace())?.pages).toHaveLength(2)
  })
})
