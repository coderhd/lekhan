import { describe, it, expect, beforeEach } from 'vitest'
import { compressSnapshot, decompressSnapshot } from '../../lib/version-history/compression'
import { MemoryHistoryAdapter } from '../../lib/version-history/adapters/memory'
import { DocumentCheckpoint } from '../../lib/version-history/types'

describe('Version History Compression', () => {
	it('should compress and decompress successfully', async () => {
		const payload = new Uint8Array([1, 2, 3, 4, 5, 1, 2, 3, 4, 5])
		const compressed = await compressSnapshot(payload)
		expect(compressed).not.toEqual(payload)
		
		const decompressed = await decompressSnapshot(compressed)
		expect(decompressed).toEqual(payload)
	})
})

describe('MemoryHistoryAdapter', () => {
	let adapter: MemoryHistoryAdapter

	beforeEach(() => {
		adapter = new MemoryHistoryAdapter()
	})

	const createCheckpoint = (
		id: string,
		pageId: string,
		createdAt: string,
		isPinned: boolean,
		byteSize: number
	): DocumentCheckpoint => ({
		id,
		pageId,
		workspaceId: 'workspace-1',
		title: 'Untitled',
		authorName: 'Test',
		authorId: 'user-1',
		createdAt,
		isPinned,
		byteSize,
		compressedPayload: new Uint8Array([1, 2, 3])
	})

	it('should save and get a checkpoint', async () => {
		const cp = createCheckpoint('cp-1', 'page-1', new Date('2024-01-01').toISOString(), false, 10)
		await adapter.saveCheckpoint(cp)

		const fetched = await adapter.getCheckpoint('page-1', 'cp-1')
		expect(fetched).toEqual(cp)
	})

	it('should list checkpoints in descending order by createdAt', async () => {
		const cp1 = createCheckpoint('cp-1', 'page-1', new Date('2024-01-01').toISOString(), false, 10)
		const cp2 = createCheckpoint('cp-2', 'page-1', new Date('2024-01-03').toISOString(), false, 10)
		const cp3 = createCheckpoint('cp-3', 'page-1', new Date('2024-01-02').toISOString(), false, 10)

		await adapter.saveCheckpoint(cp1)
		await adapter.saveCheckpoint(cp2)
		await adapter.saveCheckpoint(cp3)

		const list = await adapter.listCheckpoints('page-1')
		expect(list.map(c => c.id)).toEqual(['cp-2', 'cp-3', 'cp-1'])
	})

	it('should delete a checkpoint', async () => {
		const cp = createCheckpoint('cp-1', 'page-1', new Date('2024-01-01').toISOString(), false, 10)
		await adapter.saveCheckpoint(cp)
		await adapter.deleteCheckpoint('page-1', 'cp-1')
		
		const fetched = await adapter.getCheckpoint('page-1', 'cp-1')
		expect(fetched).toBeNull()
	})

	it('should prune auto-checkpoints when quota is exceeded, preserving pinned ones', async () => {
		const cpOld = createCheckpoint('cp-old', 'page-1', new Date('2024-01-01').toISOString(), false, 50)
		const cpPinned = createCheckpoint('cp-pinned', 'page-1', new Date('2024-01-02').toISOString(), true, 60)
		const cpNew = createCheckpoint('cp-new', 'page-1', new Date('2024-01-03').toISOString(), false, 40)

		await adapter.saveCheckpoint(cpOld)
		await adapter.saveCheckpoint(cpPinned)
		await adapter.saveCheckpoint(cpNew)

		const pruned = await adapter.pruneAutoCheckpoints('page-1', 100)
		expect(pruned).toBe(1)
		
		const list = await adapter.listCheckpoints('page-1')
		expect(list.map(c => c.id)).toEqual(['cp-new', 'cp-pinned'])
	})
})
