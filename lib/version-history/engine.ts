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
			byteSize: compressedPayload.byteLength,
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
			byteSize: compressedPayload.byteLength,
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
			for (const [key, raw] of tempDoc.share.entries()) {
				const targetExisting = targetYdoc.share.get(key)
				const isMap = (targetExisting instanceof Y.Map) || ((raw as any)._map && (raw as any)._map.size > 0)
				const isArray = (targetExisting instanceof Y.Array) || ((raw as any)._start && (raw as any)._start.content && (raw as any)._start.content.constructor.name === 'ContentAny')
				const isXmlFragment = (targetExisting instanceof Y.XmlFragment) || ((raw as any)._start && (raw as any)._start.content && (raw as any)._start.content.constructor.name === 'ContentType')
				const isText = (targetExisting instanceof Y.Text) || (!isMap && !isArray && !isXmlFragment)

				if (isText) {
					const tempType = tempDoc.getText(key)
					const type = targetYdoc.getText(key)
					type.delete(0, type.length)
					const tempStr = tempType.toString()
					if (tempStr.length > 0) {
						type.insert(0, tempStr)
					}
				} else if (isMap) {
					const tempType = tempDoc.getMap(key)
					const type = targetYdoc.getMap(key)
					for (const k of Array.from(type.keys())) {
						type.delete(k)
					}
					for (const [k, v] of tempType.entries()) {
						type.set(k, v)
					}
				} else if (isArray) {
					const tempType = tempDoc.getArray(key)
					const type = targetYdoc.getArray(key)
					type.delete(0, type.length)
					if (tempType.length > 0) {
						type.insert(0, tempType.toArray())
					}
				} else if (isXmlFragment) {
					const tempType = tempDoc.getXmlFragment(key)
					const type = targetYdoc.getXmlFragment(key)
					type.delete(0, type.length)
					if (tempType.length > 0) {
						const items = tempType.toArray().filter((el: any): el is (Y.XmlElement | Y.XmlText) => el instanceof Y.XmlElement || el instanceof Y.XmlText).map((el: any) => el.clone())
						type.insert(0, items)
					}
				}
			}

			for (const [key, type] of targetYdoc.share.entries()) {
				if (!tempDoc.share.has(key)) {
					if (type instanceof Y.Text || type instanceof Y.Array || type instanceof Y.XmlElement || type instanceof Y.XmlFragment) {
						type.delete(0, type.length)
					} else if (type instanceof Y.Map) {
						for (const k of Array.from(type.keys())) {
							type.delete(k)
						}
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
		const existing = doc.share.get(fieldName)
		if (!existing) {
			return ''
		}

		const isXml = existing instanceof Y.XmlFragment || ((existing as any)._start && (existing as any)._start.content && (existing as any)._start.content.constructor.name === 'ContentType')
		if (isXml) {
			const xmlFragment = doc.getXmlFragment(fieldName)
			let text = ''
			for (let i = 0; i < xmlFragment.length; i++) {
				const el = xmlFragment.get(i)
				if (el instanceof Y.XmlElement || el instanceof Y.XmlText) {
					text += el.toString()
				}
			}
			return text
		}

		const textType = doc.getText(fieldName)
		return textType.toString()
	}
}
