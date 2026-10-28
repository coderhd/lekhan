import { describe, it, expect, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { buildVaultFiles, buildVaultZip, type VaultPage } from '@/lib/markdown/vault-export'
import { buildZipBytes } from '@/lib/zip-write'

function md(doc: JSONContent): JSONContent {
	return doc
}

function find<T extends { path: string }>(files: T[], path: string): T | undefined {
	return files.find((f) => f.path === path)
}

function text(files: Array<{ path: string; data: unknown }>, path: string): string {
	const file = find(files, path)
	if (!file) throw new Error(`missing ${path}; have ${files.map((f) => f.path).join(', ')}`)
	return typeof file.data === 'string' ? file.data : ''
}

const HOME: VaultPage = {
	id: 'a',
	parentId: null,
	title: 'Home',
	properties: {},
	doc: md({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Welcome' }] }] }),
}

const GUIDES: VaultPage = {
	id: 'b',
	parentId: 'a',
	title: 'Guides',
	properties: {},
	doc: md({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Guide index' }] }] }),
}

const INTRO: VaultPage = {
	id: 'c',
	parentId: 'b',
	title: 'Intro',
	tags: ['pkm'],
	properties: { author: 'Ada' },
	doc: md({
		type: 'doc',
		content: [
			{
				type: 'callout',
				attrs: { type: 'note', title: 'Heads up', collapsed: false },
				content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read me first' }] }],
			},
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'See ' },
					{ type: 'text', text: '[[Home]]' },
					{ type: 'text', text: ' and ' },
					{ type: 'text', text: '[[Nowhere]]' },
				],
			},
		],
	}),
}

describe('buildVaultFiles — folder tree mirrors parent_id', () => {
	it('nests child notes under slugged ancestor folders', () => {
		const { files } = buildVaultFiles([HOME, GUIDES, INTRO])
		expect(find(files, 'home.md')).toBeTruthy()
		expect(find(files, 'home/guides.md')).toBeTruthy()
		expect(find(files, 'home/guides/intro.md')).toBeTruthy()
	})

	it('does not emit a note for folder pages but still counts them', () => {
		const folder: VaultPage = { id: 'f', parentId: null, title: 'Projects', isFolder: true }
		const { files, report } = buildVaultFiles([folder, { ...INTRO, parentId: 'f' }])
		expect(find(files, 'projects.md')).toBeUndefined()
		expect(find(files, 'projects/intro.md')).toBeTruthy()
		expect(report.folderPages).toBe(1)
		expect(report.pages).toBe(1)
	})

	it('dedupes colliding note filenames within a folder', () => {
		const a: VaultPage = { ...HOME, id: 'x', title: 'My Page' }
		const b: VaultPage = { ...HOME, id: 'y', title: 'my page' }
		const { files } = buildVaultFiles([a, b])
		const paths = files.map((f) => f.path).sort()
		expect(paths).toEqual(['my-page-2.md', 'my-page.md'])
	})
})

describe('buildVaultFiles — Obsidian dialect (seam 2)', () => {
	it('writes frontmatter from title/tags/properties and preserves callouts + wikilinks', () => {
		const { files } = buildVaultFiles([HOME, INTRO])
		const content = text(files, 'intro.md')

		expect(content).toMatch(/^---\n/)
		expect(content).toContain('title: Intro')
		expect(content).toContain('author: Ada')
		expect(content).toMatch(/tags:/)
		expect(content).toContain('- pkm')
		expect(content).toContain('> [!note] Heads up')
		expect(content).toContain('[[Home]]')
		expect(content).toContain('[[Nowhere]]')
	})

	it('counts distinct resolved/unresolved wikilink targets', () => {
		const { report } = buildVaultFiles([HOME, INTRO])
		expect(report.linksResolved).toBe(1) // Home exists
		expect(report.linksUnresolved).toBe(1) // Nowhere does not
		expect(report.direction).toBe('export')
	})
})

describe('buildVaultFiles — attachment bundling', () => {
	const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

	it('decodes base64 images to a shared attachments/ folder and rewrites the src', () => {
		const page: VaultPage = {
			id: 'p',
			parentId: null,
			title: 'Diagram',
			properties: {},
			doc: md({
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{
								type: 'image',
								attrs: { src: `data:image/png;base64,${PNG_B64}`, alt: 'pixel' },
							},
						],
					},
				],
			}),
		}
		const { files } = buildVaultFiles([page])
		const attachment = files.find((f) => f.path.startsWith('attachments/'))
		expect(attachment).toBeTruthy()
		expect(attachment!.data).toBeInstanceOf(Uint8Array)

		const body = text(files, 'diagram.md')
		expect(body).toContain(`![pixel](attachments/pixel-`)
		expect(body).not.toContain('data:image/png;base64')
	})

	it('reuses one attachment file when the same image appears twice', () => {
		const image = { type: 'image', attrs: { src: `data:image/png;base64,${PNG_B64}`, alt: 'pixel' } }
		const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [image, image] }] }
		const { files } = buildVaultFiles([{ id: 'p', parentId: null, title: 'Two', properties: {}, doc }])
		expect(files.filter((f) => f.path.startsWith('attachments/'))).toHaveLength(1)
	})
})

describe('buildVaultFiles — client-side guarantee (story 13)', () => {
	it('never calls fetch while building the vault', () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)
		try {
			buildVaultFiles([HOME, GUIDES, INTRO])
			buildVaultZip([HOME, GUIDES, INTRO])
			expect(fetchSpy).not.toHaveBeenCalled()
		} finally {
			vi.unstubAllGlobals()
		}
	})
})

describe('buildVaultZip', () => {
	it('produces a readable zip whose entries match the vault file paths', () => {
		const { zip, report } = buildVaultZip([HOME, GUIDES, INTRO])
		const unzipped = unzipSync(zip)
		const names = Object.keys(unzipped).sort()
		expect(names).toContain('home.md')
		expect(names).toContain('home/guides.md')
		expect(names).toContain('home/guides/intro.md')
		expect(strFromU8(unzipped['home/guides/intro.md'])).toContain('> [!note] Heads up')
		expect(report.pages).toBe(3)
	})
})

describe('buildZipBytes', () => {
	it('rejects duplicate paths instead of overwriting a note', () => {
		expect(() => buildZipBytes([{ path: 'a.md', data: 'x' }, { path: 'a.md', data: 'y' }])).toThrow(/Duplicate/)
	})
})
