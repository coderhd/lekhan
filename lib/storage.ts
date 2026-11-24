import type { LocalAttachment, Page, Workspace } from './types'

const databaseName = 'lekhan-writing-workspace'
const storeName = 'workspace'
const attachmentStore = 'attachments'
const workspaceKey = 'personal'

type FileReference = Omit<LocalAttachment, 'data'>
type StoredPage = Omit<Page, 'files'> & { files?: FileReference[] }
type StoredWorkspace = Omit<Workspace, 'pages'> & { pages: StoredPage[] }

export interface WorkspaceStorage {
  load: () => Promise<Workspace | undefined>
  save: (workspace: Workspace, expectedRevision: number, baseline: Workspace | null) => Promise<Workspace>
  hasChanges?: (baseline: Workspace | null) => Promise<boolean>
  prepareChange?: (previous: Workspace, next: Workspace, baseline: Workspace | null) => Workspace
}

export class WorkspaceConflictError extends Error {
  constructor() {
    super('A newer version of this workspace was saved in another tab.')
    this.name = 'WorkspaceConflictError'
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2)
    let blocked = false
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) request.result.createObjectStore(storeName)
      request.result.createObjectStore(attachmentStore)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open the workspace database.'))
    request.onblocked = () => {
      blocked = true
      reject(new Error('Close other tabs using this workspace and try again.'))
    }
    request.onsuccess = () => {
      const database = request.result
      if (blocked) {
        database.close()
        return
      }
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

export async function loadWorkspace(key = workspaceKey): Promise<Workspace | undefined> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction([storeName, attachmentStore], 'readonly')
      const request = transaction.objectStore(storeName).get(key)
      const bodies = new Map<string, Uint8Array>()
      let failure: Error | undefined
      request.onsuccess = () => {
        const current: StoredWorkspace | undefined = request.result
        const ids = new Set(current?.pages.flatMap(page => page.files?.map(file => file.id) ?? []))
        for (const id of ids) {
          const entry = transaction.objectStore(attachmentStore).get([key, id])
          entry.onsuccess = () => {
            if (entry.result instanceof Uint8Array) bodies.set(id, entry.result)
            else {
              failure = new Error('An attachment is missing from this workspace.')
              transaction.abort()
            }
          }
        }
      }
      transaction.oncomplete = () => {
        const current: StoredWorkspace | undefined = request.result
        resolve(current && { ...current, pages: current.pages.map(({ files, ...page }) => ({
          ...page, ...(files ? { files: files.map(file => ({ ...file, data: bodies.get(file.id)! })) } : {}),
        })) })
      }
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Could not read the workspace.'))
    })
  } finally {
    database.close()
  }
}

export async function saveWorkspace(workspace: Workspace, expectedRevision: number, key = workspaceKey): Promise<Workspace> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction([storeName, attachmentStore], 'readwrite', { durability: 'strict' })
      const store = transaction.objectStore(storeName)
      const files = transaction.objectStore(attachmentStore)
      const request = store.get(key)
      let failure: unknown
      const snapshot = { ...workspace, revision: expectedRevision + 1 }

      request.onsuccess = () => {
        const current: StoredWorkspace | undefined = request.result
        if ((current?.revision ?? 0) !== expectedRevision) {
          failure = new WorkspaceConflictError()
          transaction.abort()
          return
        }
        try {
          const existing = new Set(current?.pages.flatMap(page => page.files?.map(file => file.id) ?? []))
          const retained = new Set<string>()
          const pages = snapshot.pages.map(({ files: attachments, ...page }) => ({
            ...page, ...(attachments ? { files: attachments.map(({ id, filename, data }) => {
              if (!existing.has(id) && !retained.has(id)) files.put(data, [key, id])
              retained.add(id)
              return { id, filename }
            }) } : {}),
          }))
          for (const id of existing) {
            if (!retained.has(id)) files.delete([key, id])
          }
          store.put({ ...snapshot, pages }, key)
        } catch (error) {
          failure = error
          transaction.abort()
        }
      }
      transaction.oncomplete = () => resolve(snapshot)
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Could not save the workspace.'))
    })
  } finally {
    database.close()
  }
}
