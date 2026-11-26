import type { LocalAttachment, Page, Workspace } from './types'

const databaseName = 'lekhan-writing-workspace'
const storeName = 'workspace'
const attachmentStore = 'attachments'
const pageStore = 'pages'
const workspaceKey = 'personal'

type FileReference = Omit<LocalAttachment, 'data'>
type StoredPage = Omit<Page, 'files'> & { files?: (FileReference & { data?: Uint8Array })[] }
type WorkspaceMetadata = Omit<Workspace, 'pages'>
type LegacyWorkspace = WorkspaceMetadata & { pages: StoredPage[] }
type NotebookManifest = { metadata: WorkspaceMetadata; pageIds: string[]; attachmentIds: string[] }
type StoredWorkspace = LegacyWorkspace | NotebookManifest

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
    const request = indexedDB.open(databaseName, 3)
    let blocked = false
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) request.result.createObjectStore(storeName)
      if (event.oldVersion < 2) request.result.createObjectStore(attachmentStore)
      if (event.oldVersion < 3) request.result.createObjectStore(pageStore)
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
      const transaction = database.transaction([storeName, pageStore, attachmentStore], 'readonly')
      const request = transaction.objectStore(storeName).get(key)
      const bodies = new Map<string, Uint8Array>()
      let metadata: WorkspaceMetadata | undefined
      let pages: StoredPage[] = []
      let failure: Error | undefined

      function abort(message: string) {
        failure = new Error(message)
        transaction.abort()
      }

      function readAttachments() {
        const references = new Set<string>()
        for (const page of pages) {
          for (const file of page.files ?? []) {
            if (file.data instanceof Uint8Array) bodies.set(file.id, file.data)
            else references.add(file.id)
          }
        }
        for (const id of references) {
          const entry = transaction.objectStore(attachmentStore).get([key, id])
          entry.onsuccess = () => {
            if (entry.result instanceof Uint8Array) bodies.set(id, entry.result)
            else abort('An attachment is missing from this workspace.')
          }
        }
      }

      request.onsuccess = () => {
        const current: StoredWorkspace | undefined = request.result
        if (!current) return
        if ('pages' in current) {
          const { pages: legacyPages, ...rest } = current
          pages = legacyPages
          metadata = rest
          readAttachments()
          return
        }

        const { pageIds } = current
        metadata = current.metadata
        // Compound keys keep each notebook's pages together and separate accounts.
        const records = transaction.objectStore(pageStore).getAll(IDBKeyRange.bound([key], [key, []]))
        records.onsuccess = () => {
          const byId = new Map((records.result as StoredPage[]).map(page => [page.id, page]))
          for (const id of pageIds) {
            const page = byId.get(id)
            if (!page) {
              abort('A page is missing from this workspace.')
              return
            }
            pages.push(page)
          }
          readAttachments()
        }
      }

      transaction.oncomplete = () => {
        resolve(metadata && { ...metadata, pages: pages.map(({ files, ...page }) => ({
          ...page, ...(files ? { files: files.map(({ id, filename, data }) => ({ id, filename, data: data ?? bodies.get(id)! })) } : {}),
        })) })
      }
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Could not read the workspace.'))
    })
  } finally {
    database.close()
  }
}

export async function saveWorkspace(
  workspace: Workspace,
  expectedRevision: number,
  key = workspaceKey,
  previousPages?: readonly Page[],
): Promise<Workspace> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction([storeName, pageStore, attachmentStore], 'readwrite', { durability: 'strict' })
      const store = transaction.objectStore(storeName)
      const pages = transaction.objectStore(pageStore)
      const files = transaction.objectStore(attachmentStore)
      const request = store.get(key)
      let failure: unknown
      const snapshot = { ...workspace, revision: expectedRevision + 1 }

      request.onsuccess = () => {
        const current: StoredWorkspace | undefined = request.result
        const manifest = current && 'pageIds' in current ? current : undefined
        const revision = manifest?.metadata.revision ?? (current && 'pages' in current ? current.revision : 0)
        if (revision !== expectedRevision) {
          failure = new WorkspaceConflictError()
          transaction.abort()
          return
        }

        const { pages: nextPages, ...metadata } = snapshot
        try {
          // A navigation change can save the revision and active page alone.
          if (manifest && previousPages === nextPages) {
            const { pageIds, attachmentIds } = manifest
            store.put({ metadata, pageIds, attachmentIds } satisfies NotebookManifest, key)
            return
          }

          const previous = manifest && previousPages ? new Map(previousPages.map(page => [page.id, page])) : null
          const previousFiles = new Set(manifest?.attachmentIds ??
            (current && 'pages' in current ? current.pages.flatMap(page => page.files?.filter(file => !file.data).map(file => file.id) ?? []) : []))
          const retainedFiles = new Set<string>()
          const pageIds = new Set<string>()

          for (const page of nextPages) {
            if (pageIds.has(page.id)) throw new Error('This workspace contains duplicate page IDs.')
            pageIds.add(page.id)
            for (const file of page.files ?? []) {
              if (!retainedFiles.has(file.id) && !previousFiles.has(file.id)) files.put(file.data, [key, file.id])
              retainedFiles.add(file.id)
            }
            if (previous?.get(page.id) === page) continue
            const { files: attachments, ...content } = page
            pages.put({ ...content, ...(attachments ? { files: attachments.map(({ id, filename }) => ({ id, filename })) } : {}) }, [key, page.id])
          }

          for (const id of manifest?.pageIds ?? []) {
            if (!pageIds.has(id)) pages.delete([key, id])
          }
          for (const id of previousFiles) {
            if (!retainedFiles.has(id)) files.delete([key, id])
          }
          store.put({ metadata, pageIds: [...pageIds], attachmentIds: [...retainedFiles] } satisfies NotebookManifest, key)
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
