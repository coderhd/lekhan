import * as Y from 'yjs'
import { VersionHistoryStorageAdapter, DocumentCheckpoint } from './types'
import { compressSnapshot, decompressSnapshot } from './compression'

export class VersionHistoryEngine {
	private storageAdapter: VersionHistoryStorageAdapter

	constructor(storageAdapter: VersionHistoryStorageAdapter) {
		this.storageAdapter = storageAdapter
	}

	async createMilestone({ pageId, workspaceId, title, authorName, authorId, ydoc }: { pageId: string; workspaceId: string; title: string; authorName: string; authorId: string; ydoc: Y.Doc }): Promise<DocumentCheckpoint> {
		const payload = Y.encodeStateAsUpdate(ydoc)
		const compressedPayload = await compressSnapshot(payload)
		const id = crypto.randomUUID()
		const checkpoint: DocumentCheckpoint = {
			id,
			pageId,
			workspaceId,
			title,
			authorName,
			authorId,
			createdAt: new Date().toISOString(),
			isPinned: true,
			byteSize: payload.byteLength,
			compressedPayload
		}
		await this.storageAdapter.saveCheckpoint(checkpoint)
		return checkpoint
	}

	async createAutoCheckpoint({ pageId, workspaceId, title, authorName, authorId, ydoc, maxStorageBytes }: { pageId: string; workspaceId: string; title?: string; authorName: string; authorId: string; ydoc: Y.Doc; maxStorageBytes?: number }): Promise<DocumentCheckpoint> {
		const payload = Y.encodeStateAsUpdate(ydoc)
		const compressedPayload = await compressSnapshot(payload)
		const id = crypto.randomUUID()
		const checkpoint: DocumentCheckpoint = {
			id,
			pageId,
			workspaceId,
			title: title || 'Auto-save',
			authorName,
			authorId,
			createdAt: new Date().toISOString(),
			isPinned: false,
			byteSize: payload.byteLength,
			compressedPayload
		}
		await this.storageAdapter.saveCheckpoint(checkpoint)

		if (maxStorageBytes !== undefined) {
			await this.storageAdapter.pruneAutoCheckpoints(pageId, maxStorageBytes)
		}

		return checkpoint
	}

	async restoreCheckpoint({ pageId, workspaceId, checkpointId, targetYdoc, authorName, authorId }: { pageId: string; workspaceId: string; checkpointId: string; targetYdoc: Y.Doc; authorName: string; authorId: string }): Promise<DocumentCheckpoint> {
		const checkpoint = await this.storageAdapter.getCheckpoint(pageId, checkpointId)
		if (!checkpoint) {
			throw new Error('Checkpoint not found')
		}

		const decompressed = await decompressSnapshot(checkpoint.compressedPayload)
		const tempDoc = new Y.Doc()
		Y.applyUpdate(tempDoc, decompressed)

		targetYdoc.transact(() => {
			for (const [key, type] of targetYdoc.share.entries()) {
				if (type instanceof Y.Text) {
					const tempType = tempDoc.getText(key)
					const targetStr = type.toString()
					const tempStr = tempType.toString()
					
					type.delete(0, type.length)
					if (tempStr.length > 0) {
						type.insert(0, tempStr)
					}
				} else if (type instanceof Y.Map) {
					const tempType = tempDoc.getMap(key)
					for (const k of Array.from(type.keys())) {
						type.delete(k)
					}
					for (const [k, v] of tempType.entries()) {
						type.set(k, v)
					}
				} else if (type instanceof Y.Array) {
					const tempType = tempDoc.getArray(key)
					type.delete(0, type.length)
					if (tempType.length > 0) {
						type.insert(0, tempType.toArray())
					}
				} else if (type instanceof Y.XmlElement) {
					const tempType = tempDoc.getXmlElement(key)
					type.delete(0, type.length)
					if (tempType.length > 0) {
						const items = tempType.toArray().filter((el: any): el is (Y.XmlElement | Y.XmlText) => el instanceof Y.XmlElement || el instanceof Y.XmlText).map((el: any) => el.clone())
						type.insert(0, items)
					}
				} else if (type instanceof Y.XmlFragment) {
					const tempType = tempDoc.getXmlFragment(key)
					type.delete(0, type.length)
					if (tempType.length > 0) {
						const items = tempType.toArray().filter((el: any): el is (Y.XmlElement | Y.XmlText) => el instanceof Y.XmlElement || el instanceof Y.XmlText).map((el: any) => el.clone())
						type.insert(0, items)
					}
				}
			}
		}, authorId)

		return await this.createAutoCheckpoint({
			pageId,
			workspaceId,
			title: 'Restored to milestone: ' + checkpoint.title,
			authorName,
			authorId,
			ydoc: targetYdoc
		})
	}

	async listVersions(pageId: string): Promise<DocumentCheckpoint[]> {
		return this.storageAdapter.listCheckpoints(pageId)
	}

	async getCheckpoint(pageId: string, checkpointId: string): Promise<DocumentCheckpoint | null> {
		return this.storageAdapter.getCheckpoint(pageId, checkpointId)
	}

	async deleteCheckpoint(pageId: string, checkpointId: string): Promise<void> {
		return this.storageAdapter.deleteCheckpoint(pageId, checkpointId)
	}

	async getSnapshotDoc(checkpoint: DocumentCheckpoint): Promise<Y.Doc> {
		const decompressed = await decompressSnapshot(checkpoint.compressedPayload)
		const tempDoc = new Y.Doc()
		Y.applyUpdate(tempDoc, decompressed)
		return tempDoc
	}

	async getSnapshotText(checkpoint: DocumentCheckpoint, fieldName: string = 'default'): Promise<string> {
		const doc = await this.getSnapshotDoc(checkpoint)
		const textType = doc.getText(fieldName)
		if (textType && textType.length > 0) {
			return textType.toString()
		}
		
		const xmlFragment = doc.getXmlFragment(fieldName)
		if (xmlFragment && xmlFragment.length > 0) {
			let text = ''
			for (let i = 0; i < xmlFragment.length; i++) {
				const el = xmlFragment.get(i)
				if (el instanceof Y.XmlElement || el instanceof Y.XmlText) {
					text += el.toString()
				}
			}
			return text
		}
		
		return ''
	}
}
