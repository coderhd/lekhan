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

  it('separates browser replicas for different signed-in accounts', async () => {
    const empty = { pages: [], activePageId: null, revision: 0 }
    const left = createPage(empty, { title: 'Private account A page' })
    const right = createPage(empty, { title: 'Private account B page' })
    await Promise.all([saveWorkspace(left, 0, 'account:a'), saveWorkspace(right, 0, 'account:b')])
    expect((await loadWorkspace('account:a'))?.pages.map(page => page.title)).toEqual(['Private account A page'])
    expect((await loadWorkspace('account:b'))?.pages.map(page => page.title)).toEqual(['Private account B page'])
    expect((await loadWorkspace())?.pages.some(page => page.title.startsWith('Private account'))).toBe(false)
  })
})
