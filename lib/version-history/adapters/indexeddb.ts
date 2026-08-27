import { openDB, IDBPDatabase } from 'idb'
import { DocumentCheckpoint, VersionHistoryStorageAdapter } from '../types'

const DB_NAME = 'lekhan_history_v1'
const DB_VERSION = 1
const STORE_NAME = 'checkpoints'

export class IndexedDBHistoryAdapter implements VersionHistoryStorageAdapter {
	private dbPromise: Promise<IDBPDatabase | null>

	constructor() {
		if (typeof indexedDB === 'undefined') {
			this.dbPromise = Promise.resolve(null)
		} else {
			this.dbPromise = openDB(DB_NAME, DB_VERSION, {
				upgrade(db) {
					if (!db.objectStoreNames.contains(STORE_NAME)) {
						const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
						store.createIndex('pageId', 'pageId')
						store.createIndex('createdAt', 'createdAt')
						store.createIndex('isPinned', 'isPinned')
					}
				}
			})
		}
	}

	private async getDB(): Promise<IDBPDatabase> {
		const db = await this.dbPromise
		if (!db) {
			throw new Error('IndexedDB is not available in this environment')
		}
		return db
	}

	async saveCheckpoint(checkpoint: DocumentCheckpoint): Promise<void> {
		const db = await this.getDB()
		await db.put(STORE_NAME, checkpoint)
	}

	async listCheckpoints(pageId: string): Promise<DocumentCheckpoint[]> {
		const db = await this.getDB()
		const checkpoints = await db.getAllFromIndex(STORE_NAME, 'pageId', pageId)
		return checkpoints.sort((a, b) => 
			new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		)
	}

	async getCheckpoint(pageId: string, checkpointId: string): Promise<DocumentCheckpoint | null> {
		const db = await this.getDB()
		const checkpoint = await db.get(STORE_NAME, checkpointId)
		if (checkpoint && checkpoint.pageId === pageId) {
			return checkpoint
		}
		return null
	}

	async deleteCheckpoint(pageId: string, checkpointId: string): Promise<void> {
		const db = await this.getDB()
		await db.delete(STORE_NAME, checkpointId)
	}

	async pruneAutoCheckpoints(pageId: string, maxStorageBytes: number): Promise<number> {
		const db = await this.getDB()
		const checkpoints = await db.getAllFromIndex(STORE_NAME, 'pageId', pageId)
		
		let totalBytes = checkpoints.reduce((sum, cp) => sum + cp.byteSize, 0)
		let prunedCount = 0

		if (totalBytes <= maxStorageBytes) {
			return 0
		}

		const unpinned = checkpoints
			.filter(cp => !cp.isPinned)
			.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

		for (const cp of unpinned) {
			if (totalBytes <= maxStorageBytes) {
				break
			}
			await db.delete(STORE_NAME, cp.id)
			totalBytes -= cp.byteSize
			prunedCount++
		}

		return prunedCount
	}
}
