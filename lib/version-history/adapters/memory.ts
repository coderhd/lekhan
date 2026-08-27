import { DocumentCheckpoint, VersionHistoryStorageAdapter } from '../types'

export class MemoryHistoryAdapter implements VersionHistoryStorageAdapter {
	private store = new Map<string, DocumentCheckpoint[]>()

	async saveCheckpoint(checkpoint: DocumentCheckpoint): Promise<void> {
		const pageId = checkpoint.pageId
		const existing = this.store.get(pageId) || []
		
		const index = existing.findIndex(cp => cp.id === checkpoint.id)
		if (index !== -1) {
			existing[index] = checkpoint
		} else {
			existing.push(checkpoint)
		}
		
		this.store.set(pageId, existing)
	}

	async listCheckpoints(pageId: string): Promise<DocumentCheckpoint[]> {
		const checkpoints = this.store.get(pageId) || []
		return [...checkpoints].sort((a, b) => 
			new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		)
	}

	async getCheckpoint(pageId: string, checkpointId: string): Promise<DocumentCheckpoint | null> {
		const checkpoints = this.store.get(pageId) || []
		return checkpoints.find(cp => cp.id === checkpointId) || null
	}

	async deleteCheckpoint(pageId: string, checkpointId: string): Promise<void> {
		const checkpoints = this.store.get(pageId) || []
		this.store.set(
			pageId,
			checkpoints.filter(cp => cp.id !== checkpointId)
		)
	}

	async pruneAutoCheckpoints(pageId: string, maxStorageBytes: number): Promise<number> {
		const checkpoints = this.store.get(pageId) || []
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
			await this.deleteCheckpoint(pageId, cp.id)
			totalBytes -= cp.byteSize
			prunedCount++
		}

		return prunedCount
	}
}
