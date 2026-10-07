import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { MarkdownEngine, base64ToUint8Array, fitLiveSchema } from '@/lib/markdown/engine'
import { loadVaultPageDocs, toVaultPage } from '@/lib/markdown/vault-export-loader'
import type { VaultPage } from '@/lib/markdown/vault-export'
import type { JSONContent } from '@tiptap/core'

// ---------------------------------------------------------------------------
// SIL-9 S4a — vault-export content loader. Seam: engine Yjs->JSON round trip
// (ADR 0005) + the pure orchestration loader (ADR 0006).
// ---------------------------------------------------------------------------

function page(id: string, overrides: Partial<VaultPage> = {}): VaultPage {
	return { id, parentId: null, title: id.toUpperCase(), properties: {}, ...overrides }
}

describe('MarkdownEngine.yjsStateToJson — inverse of seedToYjsBase64', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	// seedToYjsBase64 normalizes to the live schema (fitLiveSchema): a leading
	// title heading and no trailing empty paragraph. That normalization is by
	// design, so the inverse compares against the normalized doc.
	it('round-trips a heading + paragraph doc to the same IR', () => {
		const doc = engine.parse('# Title\n\nBody text here.\n')
		const back = engine.yjsStateToJson(base64ToUint8Array(engine.seedToYjsBase64(doc)))
		expect(back).toEqual(fitLiveSchema(doc))
	})

	it('preserves inline marks', () => {
		const doc = engine.parse('# T\n\nSome **bold** and *italic* text.\n')
		const back = engine.yjsStateToJson(base64ToUint8Array(engine.seedToYjsBase64(doc)))
		expect(back).toEqual(fitLiveSchema(doc))
	})

	it('preserves callouts, tags and wikilinks (S3 dialect)', () => {
		const doc = engine.parse('# T\n\n> [!note] Heads up\n> Body\n\nSee [[Alpha]] #pkm.\n')
		const back = engine.yjsStateToJson(base64ToUint8Array(engine.seedToYjsBase64(doc)))
		expect(back).toEqual(fitLiveSchema(doc))
	})

	it('preserves lists and tables', () => {
		const doc = engine.parse('# T\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n')
		const back = engine.yjsStateToJson(base64ToUint8Array(engine.seedToYjsBase64(doc)))
		expect(back).toEqual(fitLiveSchema(doc))
	})

	// A never-edited Page (local + remote empty) is a genuinely empty doc, not a
	// read failure: the vault export must serialize it as a title-only note with
	// no "content could not be read" warning (S4a clean-room finding).
	it('returns an empty doc for an empty (never-edited) Yjs state', () => {
		const back = engine.yjsStateToJson(Y.encodeStateAsUpdate(new Y.Doc()))
		expect(back.type).toBe('doc')
		expect(back.content ?? []).toEqual([])
	})
})

describe('toVaultPage', () => {
	it('maps graph metadata and trims blank tags', () => {
		const vault = toVaultPage(
			{ id: 'p1', parentId: 'root', title: 'Guide', properties: { author: 'Ada' } },
			['pkm', '  ', ''],
		)
		expect(vault).toEqual({
			id: 'p1',
			parentId: 'root',
			title: 'Guide',
			properties: { author: 'Ada' },
			tags: ['pkm'],
			isFolder: false,
		})
	})

	it('marks imported folder pages (properties.importFolder)', () => {
		expect(toVaultPage({ id: 'f', parentId: null, title: 'Docs', properties: { importFolder: true } }).isFolder).toBe(true)
		expect(toVaultPage({ id: 'p', parentId: null, title: 'Note', properties: {} }).isFolder).toBe(false)
	})
})

describe('loadVaultPageDocs', () => {
	const DOC = (label: string): JSONContent => ({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }],
	})

	it('fills the doc for every non-folder page, preserving order', async () => {
		const pages = [page('a'), page('b'), page('c')]
		const { pages: out, warnings } = await loadVaultPageDocs(pages, {
			loadDoc: async (id) => DOC(`body:${id}`),
		})
		expect(warnings).toEqual([])
		expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c'])
		expect(out.map((p) => p.doc?.content?.[0]?.content?.[0]?.text)).toEqual(['body:a', 'body:b', 'body:c'])
	})

	it('bounds concurrency', async () => {
		let active = 0
		let peak = 0
		const pages = Array.from({ length: 12 }, (_, i) => page(`p${i}`))
		await loadVaultPageDocs(pages, {
			concurrency: 3,
			loadDoc: async (id) => {
				active += 1
				peak = Math.max(peak, active)
				await new Promise((resolve) => setTimeout(resolve, 2))
				active -= 1
				return DOC(id)
			},
		})
		expect(peak).toBeLessThanOrEqual(3)
		expect(peak).toBeGreaterThan(1)
	})

	it('skips folder pages (no load, no doc)', async () => {
		const seen: string[] = []
		const pages = [page('a'), page('folder', { isFolder: true }), page('b')]
		const { pages: out } = await loadVaultPageDocs(pages, {
			loadDoc: async (id) => { seen.push(id); return DOC(id) },
		})
		expect(seen).toEqual(['a', 'b'])
		expect(out.find((p) => p.id === 'folder')?.doc).toBeUndefined()
	})

	it('warns (and continues) when a page throws', async () => {
		const pages = [page('good'), page('bad', { title: 'Bad Page' }), page('after')]
		const { pages: out, warnings } = await loadVaultPageDocs(pages, {
			loadDoc: async (id) => {
				if (id === 'bad') throw new Error('collab unavailable')
				return DOC(id)
			},
		})
		expect(out.find((p) => p.id === 'bad')?.doc).toBeUndefined()
		expect(out.find((p) => p.id === 'after')?.doc).toBeDefined()
		expect(warnings).toEqual([{ title: 'Bad Page', stage: 'content', error: 'collab unavailable' }])
	})

	it('warns (and continues) when a page resolves to null', async () => {
		const pages = [page('empty', { title: 'Empty' })]
		const { warnings } = await loadVaultPageDocs(pages, { loadDoc: async () => null })
		expect(warnings).toEqual([{ title: 'Empty', stage: 'content', error: 'page content was not available' }])
	})

	it('reports progress once per non-folder page with the right total', async () => {
		const progress: Array<{ done: number; total: number }> = []
		const pages = [page('a'), page('folder', { isFolder: true }), page('b')]
		await loadVaultPageDocs(pages, {
			loadDoc: async (id) => DOC(id),
			onProgress: (p) => progress.push(p),
		})
		expect(progress).toHaveLength(2)
		expect(progress.at(-1)).toEqual({ done: 2, total: 2 })
	})

	it('handles an empty workspace without spawning work', async () => {
		const { pages: out, warnings } = await loadVaultPageDocs([], { loadDoc: async () => DOC('x') })
		expect(out).toEqual([])
		expect(warnings).toEqual([])
	})
})
