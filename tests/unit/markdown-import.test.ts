import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importMarkdownFile, consumePendingImport, titleFromFilename } from '@/services/import'

const createPage = vi.fn()

vi.mock('@/services/graph', () => ({
	createPage: (...args: any[]) => createPage(...args),
}))

const PAGE = {
	id: 'page-1',
	workspace_id: 'ws-1',
	parent_id: null,
	title: 'My Note',
	owner_id: 'user-1',
	icon: null,
	cover: null,
	properties: {},
	is_public: false,
	created_at: '2026-08-19T00:00:00Z',
	updated_at: '2026-08-19T00:00:00Z',
}

describe('titleFromFilename', () => {
	it('strips the extension and collapses separators into spaces', () => {
		expect(titleFromFilename('my-notes.md')).toBe('my notes')
		expect(titleFromFilename('Project_Plan.MD')).toBe('Project Plan')
		expect(titleFromFilename('deep/nested/note.markdown')).toBe('deep/nested/note')
	})

	it('falls back for an empty filename', () => {
		expect(titleFromFilename('')).toBe('Untitled')
	})
})

describe('importMarkdownFile', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		createPage.mockResolvedValue(PAGE)
	})

	it('parses frontmatter into title, properties and tags; creates the page; stashes the body keyed by page id', async () => {
		const file = '---\ntitle: My Note\ntags: [work, ai]\nauthor: Harsh\n---\n# Heading\n\nBody text\n'
		const page = await importMarkdownFile(file, { workspaceId: 'ws-1', ownerId: 'user-1', filename: 'ignored.md' })

		expect(createPage).toHaveBeenCalledWith('ws-1', 'user-1', null, {
			title: 'My Note',
			properties: { author: 'Harsh', tags: ['work', 'ai'] },
		})
		expect(page.id).toBe('page-1')

		// The markdown body is stashed keyed by the new page id.
		expect(consumePendingImport('page-1')).toBe('# Heading\n\nBody text\n')
		// Cleared after consumption — a second read returns null.
		expect(consumePendingImport('page-1')).toBeNull()
	})

	it('falls back to the filename for the title', async () => {
		await importMarkdownFile('# Body only\n', { workspaceId: 'ws-1', ownerId: 'user-1', filename: 'my-notes.md' })
		expect(createPage).toHaveBeenCalledWith('ws-1', 'user-1', null, {
			title: 'my notes',
			properties: {},
		})
	})

	it('imports a frontmatter-less file cleanly (title from filename, no properties)', async () => {
		const page = await importMarkdownFile('Just a body\n', { workspaceId: 'ws-1', ownerId: 'user-1', filename: 'plain.md' })
		expect(createPage).toHaveBeenCalledWith('ws-1', 'user-1', null, { title: 'plain', properties: {} })
		expect(consumePendingImport(page.id)).toBe('Just a body\n')
	})

	it('throws without creating a page for an empty file', async () => {
		await expect(importMarkdownFile('   \n  ', { workspaceId: 'ws-1', ownerId: 'user-1', filename: 'empty.md' }))
			.rejects.toThrow(/empty/i)
		expect(createPage).not.toHaveBeenCalled()
	})

	it('throws without creating a page for malformed frontmatter', async () => {
		await expect(importMarkdownFile('---\ntitle: [unclosed\n---\nbody\n', { workspaceId: 'ws-1', ownerId: 'user-1', filename: 'bad.md' }))
			.rejects.toThrow()
		expect(createPage).not.toHaveBeenCalled()
	})

	it('does not stash a payload when page creation fails', async () => {
		createPage.mockRejectedValueOnce(new Error('insert failed'))
		await expect(importMarkdownFile('# Body\n', { workspaceId: 'ws-1', ownerId: 'user-1', filename: 'a.md' }))
			.rejects.toThrow('insert failed')
		expect(consumePendingImport(PAGE.id)).toBeNull()
	})

	it('stashes the raw body (not the serialized doc) so the editor parses it on open', async () => {
		// A body with a trailing newline stays byte-for-byte identical in the payload.
		await importMarkdownFile('# A\n\nB\n', { workspaceId: 'ws-1', ownerId: 'user-1', filename: 'a.md' })
		expect(consumePendingImport(PAGE.id)).toBe('# A\n\nB\n')
	})
})

describe('consumePendingImport', () => {
	it('returns null for unknown page ids', () => {
		expect(consumePendingImport('missing')).toBeNull()
	})
})