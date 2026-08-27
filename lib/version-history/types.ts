export interface DocumentCheckpoint {
	id: string
	pageId: string
	workspaceId: string
	title: string
	authorName: string
	authorId: string
	createdAt: string
	isPinned: boolean
	byteSize: number
	compressedPayload: Uint8Array
	stateVector?: Uint8Array
}

export interface VersionHistoryStorageAdapter {
	saveCheckpoint(checkpoint: DocumentCheckpoint): Promise<void>
	listCheckpoints(pageId: string): Promise<DocumentCheckpoint[]>
	getCheckpoint(pageId: string, checkpointId: string): Promise<DocumentCheckpoint | null>
	deleteCheckpoint(pageId: string, checkpointId: string): Promise<void>
	pruneAutoCheckpoints(pageId: string, maxStorageBytes: number): Promise<number>
}
