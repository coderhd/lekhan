import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
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

  it('upgrades saved notebooks and persists each shared attachment independently of text revisions', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    try {
      const note = createPage({ pages: [], activePageId: null, revision: 0 }, { title: 'Migrated notebook' })
      await new Promise<void>((resolve, reject) => {
        const database = indexedDB.open('lekhan-writing-workspace', 1)
        database.onupgradeneeded = () => database.result.createObjectStore('workspace').put(note, 'account:legacy')
        database.onsuccess = () => { database.result.close(); resolve() }
        database.onerror = () => reject(database.error)
      })
      const migrated = await loadWorkspace('account:legacy')
      expect(migrated).toEqual(note)

      const file = { id: 'shared-file', filename: 'Guide.pdf', data: Uint8Array.of(7, 8, 9) }
      const root = { ...note.pages[0], files: [file] }
      const second = { ...root, id: 'second-page', title: 'Reference' }
      const saved = await saveWorkspace({ ...note, pages: [root, second] }, 0, 'account:legacy')
      await saveWorkspace({ ...note, pages: [{ ...root, files: [{ ...file, data: Uint8Array.of(4) }] }] }, 0, 'account:other')
      const edited = await saveWorkspace({ ...saved, pages: [{ ...second, markdown: 'Updated text.' }] }, saved.revision, 'account:legacy')
      expect((await loadWorkspace('account:legacy'))?.pages[0].files).toEqual([file])
      expect((await loadWorkspace('account:other'))?.pages[0].files?.[0].data).toEqual(Uint8Array.of(4))

      await saveWorkspace({ ...edited, pages: [], activePageId: null }, edited.revision, 'account:legacy')
      const storedBytes = await new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('lekhan-writing-workspace')
        open.onsuccess = () => {
          const database = open.result
          const transaction = database.transaction('attachments')
          const request = transaction.objectStore('attachments').get(['account:legacy', file.id])
          transaction.oncomplete = () => { database.close(); resolve(request.result) }
          transaction.onabort = () => { database.close(); reject(transaction.error) }
        }
        open.onerror = () => reject(open.error)
      })
      expect(storedBytes).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
