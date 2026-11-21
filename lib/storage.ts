import type { Workspace } from './types'

const databaseName = 'lekhan-writing-workspace'
const storeName = 'workspace'
const workspaceKey = 'personal'

export class WorkspaceConflictError extends Error {
  constructor() {
    super('A newer version of this workspace was saved in another tab.')
    this.name = 'WorkspaceConflictError'
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    let blocked = false
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName)
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

export async function loadWorkspace(): Promise<Workspace | undefined> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get(workspaceKey)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not read the workspace.'))
    })
  } finally {
    database.close()
  }
}

export async function saveWorkspace(workspace: Workspace, expectedRevision: number): Promise<Workspace> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
      const store = transaction.objectStore(storeName)
      const request = store.get(workspaceKey)
      let failure: unknown
      const snapshot = { ...workspace, revision: expectedRevision + 1 }

      request.onsuccess = () => {
        const current: Workspace | undefined = request.result
        if ((current?.revision ?? 0) !== expectedRevision) {
          failure = new WorkspaceConflictError()
          transaction.abort()
          return
        }
        try {
          store.put(snapshot, workspaceKey)
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
