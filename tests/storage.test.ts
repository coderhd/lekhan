import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createPage, updatePage } from '../lib/workspace'
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
      saveWorkspace(first, stored.revision, 'personal', stored.pages),
      saveWorkspace(second, stored.revision, 'personal', stored.pages),
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

  it('writes just the edited page and reads pages in notebook order', async () => {
    const key = 'account:incremental'
    const initial = createPage(createPage({ pages: [], activePageId: null, revision: 0 }, { title: 'First page' }), { title: 'Second page' })
    const stored = await saveWorkspace(initial, 0, key)
    const [first, second] = stored.pages
    const edited = updatePage(stored, second.id, { markdown: 'A durable edit.' })
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    const pageWrites = () => put.mock.calls.flatMap(([, recordKey], i) =>
      (put.mock.contexts[i] as IDBObjectStore).name === 'pages' ? [recordKey] : [])
    try {
      const saved = await saveWorkspace(edited, stored.revision, key, stored.pages)
      expect(pageWrites()).toEqual([[key, second.id]])
      put.mockClear()
      const opened = await saveWorkspace({ ...saved, activePageId: first.id }, saved.revision, key, saved.pages)
      expect(pageWrites()).toEqual([])
      const reordered = await saveWorkspace({ ...opened, pages: [opened.pages[1], first] }, opened.revision, key, opened.pages)
      expect(pageWrites()).toEqual([])
      expect(await loadWorkspace(key)).toEqual(reordered)
    } finally {
      put.mockRestore()
    }
  })

  it('migrates a version 2 notebook with attachments on its first successful save', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    try {
      const key = 'account:legacy-v2'
      const created = createPage({ pages: [], activePageId: null, revision: 0 }, { title: 'Legacy notes' })
      const file = { id: 'guide', filename: 'Guide.pdf', data: Uint8Array.of(7, 8, 9) }
      const legacy = { ...created, revision: 14, pages: [{ ...created.pages[0], files: [{ id: file.id, filename: file.filename }] }] }
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('lekhan-writing-workspace', 2)
        request.onupgradeneeded = () => {
          request.result.createObjectStore('workspace').put(legacy, key)
          request.result.createObjectStore('attachments').put(file.data, [key, file.id])
        }
        request.onsuccess = () => { request.result.close(); resolve() }
        request.onerror = () => reject(request.error)
      })

      const loaded = (await loadWorkspace(key))!
      expect(loaded.pages[0].files).toEqual([file])
      const edited = updatePage(loaded, loaded.pages[0].id, { markdown: 'Edited after upgrade.' })
      const badPage = { ...edited.pages[0], id: 'bad-page', properties: { invalid: () => null } }
      await expect(saveWorkspace({ ...edited, pages: [...edited.pages, badPage] }, loaded.revision, key, loaded.pages)).rejects.toMatchObject({ name: 'DataCloneError' })
      expect(await loadWorkspace(key)).toEqual(loaded)
      const saved = await saveWorkspace(edited, loaded.revision, key, loaded.pages)
      expect(await loadWorkspace(key)).toEqual(saved)
      await expect(saveWorkspace(loaded, loaded.revision, key, loaded.pages)).rejects.toBeInstanceOf(WorkspaceConflictError)
    } finally {
      vi.unstubAllGlobals()
    }
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
