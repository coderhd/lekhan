import type { Page } from '../types'

const databaseName = 'lekhan-cloud-search'
const storeName = 'pages'
const changes = new EventTarget()

type SearchPage = Pick<Page, 'id' | 'title' | 'markdown' | 'properties' | 'updatedAt'>
type StoredPage = SearchPage & { subject: string }

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: ['subject', 'id'] }).createIndex('subject', 'subject')
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })
}

async function access<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode)
      const request = work(transaction.objectStore(storeName))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function readCloudSearchPages(subject: string): Promise<Page[]> {
  const matches: StoredPage[] = await access('readonly', store => store.index('subject').getAll(subject))
  return matches.map(({ id, title, markdown, properties, updatedAt }) => ({
    id, title, markdown, properties, updatedAt, parentId: null, favorite: false, createdAt: updatedAt,
  }))
}

export function subscribeCloudSearchPages(subject: string, changed: () => void) {
  changes.addEventListener(subject, changed)
  return () => changes.removeEventListener(subject, changed)
}

export async function rememberCloudSearchPage(subject: string, page: SearchPage) {
  const { id, title, updatedAt } = page
  // Inline image bytes already live in the replica and contribute no searchable words.
  const markdown = page.markdown.replace(/data:image\/[a-z0-9+.-]+;base64,[a-z0-9+/=]+/gi, '')
  const rawTags = page.properties?.tags
  const tags = Array.isArray(rawTags) ? rawTags.filter(tag => typeof tag === 'string') : typeof rawTags === 'string' ? rawTags : undefined
  await access('readwrite', store => store.put({ subject, id, title, markdown, properties: { tags }, updatedAt }))
  changes.dispatchEvent(new Event(subject))
}

export async function forgetCloudSearchPage(subject: string, pageId: string) {
  await access('readwrite', store => store.delete([subject, pageId]))
  changes.dispatchEvent(new Event(subject))
}
