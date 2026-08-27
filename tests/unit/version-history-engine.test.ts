import { describe, it, expect, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { VersionHistoryEngine } from '../../lib/version-history/engine'
import { VersionHistoryStorageAdapter, DocumentCheckpoint } from '../../lib/version-history/types'

class MockStorageAdapter implements VersionHistoryStorageAdapter {
	public checkpoints: Map<string, DocumentCheckpoint> = new Map()
	public prunedCount = 0

	async saveCheckpoint(checkpoint: DocumentCheckpoint): Promise<void> {
		this.checkpoints.set(checkpoint.id, checkpoint)
	}

	async listCheckpoints(pageId: string): Promise<DocumentCheckpoint[]> {
		return Array.from(this.checkpoints.values()).filter(c => c.pageId === pageId)
	}

	async getCheckpoint(pageId: string, checkpointId: string): Promise<DocumentCheckpoint | null> {
		const c = this.checkpoints.get(checkpointId)
		return (c && c.pageId === pageId) ? c : null
	}

	async deleteCheckpoint(pageId: string, checkpointId: string): Promise<void> {
		this.checkpoints.delete(checkpointId)
	}

	async pruneAutoCheckpoints(pageId: string, maxStorageBytes: number): Promise<number> {
		if (pageId && maxStorageBytes >= 0) {
			this.prunedCount++
		}
		return 1
	}
}

describe('VersionHistoryEngine', () => {
	let adapter: MockStorageAdapter
	let engine: VersionHistoryEngine

	beforeEach(() => {
		adapter = new MockStorageAdapter()
		engine = new VersionHistoryEngine(adapter)
	})

	it('createMilestone creates pinned checkpoint and stores in adapter', async () => {
		const ydoc = new Y.Doc()
		ydoc.getText('content').insert(0, 'Hello world')

		const cp = await engine.createMilestone({
			pageId: 'page1',
			workspaceId: 'ws1',
			title: 'Milestone 1',
			authorName: 'Alice',
			authorId: 'a1',
			ydoc
		})

		expect(cp.isPinned).toBe(true)
		expect(cp.title).toBe('Milestone 1')
		expect(adapter.checkpoints.has(cp.id)).toBe(true)
	})

	it('createAutoCheckpoint creates unpinned checkpoint and respects quota pruning', async () => {
		const ydoc = new Y.Doc()
		ydoc.getText('content').insert(0, 'Auto save')

		const cp = await engine.createAutoCheckpoint({
			pageId: 'page1',
			workspaceId: 'ws1',
			authorName: 'Alice',
			authorId: 'a1',
			ydoc,
			maxStorageBytes: 1000
		})

		expect(cp.isPinned).toBe(false)
		expect(cp.title).toBe('Auto-save')
		expect(adapter.prunedCount).toBe(1)
	})

	it('restoreCheckpoint restores content to target Y.Doc non-destructively and creates a new forward checkpoint', async () => {
		const ydoc = new Y.Doc()
		ydoc.getText('content').insert(0, 'Initial state')
		
		const cp1 = await engine.createMilestone({
			pageId: 'page1',
			workspaceId: 'ws1',
			title: 'V1',
			authorName: 'Alice',
			authorId: 'a1',
			ydoc
		})

		// Modify doc
		ydoc.getText('content').delete(0, 13)
		ydoc.getText('content').insert(0, 'Modified state')

		// Restore
		const cp2 = await engine.restoreCheckpoint({
			pageId: 'page1',
			workspaceId: 'ws1',
			checkpointId: cp1.id,
			targetYdoc: ydoc,
			authorName: 'Bob',
			authorId: 'b1'
		})

		expect(ydoc.getText('content').toString()).toBe('Initial state')
		expect(cp2.isPinned).toBe(false)
		expect(cp2.title).toBe('Restored to milestone: V1')
		
		// Original checkpoint should still exist
		expect(adapter.checkpoints.has(cp1.id)).toBe(true)
		expect(adapter.checkpoints.has(cp2.id)).toBe(true)
	})

	it('restoreCheckpoint restores absent roots and removes extraneous roots', async () => {
		const ydoc1 = new Y.Doc()
		ydoc1.getText('rootA').insert(0, 'Content A')
		ydoc1.getArray('rootB').insert(0, ['item1', 'item2'])

		const cp = await engine.createMilestone({
			pageId: 'page1',
			workspaceId: 'ws1',
			title: 'Multi-root V1',
			authorName: 'Alice',
			authorId: 'a1',
			ydoc: ydoc1
		})

		const ydoc2 = new Y.Doc()
		ydoc2.getText('rootC').insert(0, 'Extra root')

		await engine.restoreCheckpoint({
			pageId: 'page1',
			workspaceId: 'ws1',
			checkpointId: cp.id,
			targetYdoc: ydoc2,
			authorName: 'Bob',
			authorId: 'b1'
		})

		expect(ydoc2.getText('rootA').toString()).toBe('Content A')
		expect(ydoc2.getArray('rootB').toArray()).toEqual(['item1', 'item2'])
		expect(ydoc2.getText('rootC').toString()).toBe('')
	})

	it('getSnapshotText returns extracted plain text', async () => {
		const ydoc = new Y.Doc()
		ydoc.getText('default').insert(0, 'Snapshot text content')
		
		const cp = await engine.createMilestone({
			pageId: 'page1',
			workspaceId: 'ws1',
			title: 'V1',
			authorName: 'Alice',
			authorId: 'a1',
			ydoc
		})

		const text = await engine.getSnapshotText(cp, 'default')
		expect(text).toBe('Snapshot text content')
	})
})
