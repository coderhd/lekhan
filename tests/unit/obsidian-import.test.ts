import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { readVaultZip } from '@/services/obsidian-import'
import { importObsidianVault, type ObsidianImportPage } from '@/services/obsidian-import'
import { base64ToUint8Array } from '@/lib/yjs-seed'

async function fixtureVault(): Promise<Parameters<typeof importObsidianVault>[0]> {
	const zip = new JSZip()
	zip.file('guides/intro.md', [
		'---',
		'title: Introduction',
		'tags: [guide, import]',
		'author: Harsh',
		'---',
		'# Intro',
		'',
		'See [[alpha]] and [[Missing Note]]',
		'',
		'> [!note] Tip',
		'> Callout body',
		'',
		'```ts',
		'const x = 1',
		'```',
		'',
	].join('\n'))
	zip.file('guides/alpha.md', '# Alpha\n\nRead [[Introduction|the intro]] #work\n')
	zip.file('guides/plain.md', 'Just body text, no heading\n')
	zip.file('root.md', '# Root\n\n![[pic.png]]\n\n![[unknown.png]]\n\nSee [[alpha]] again\n')
	zip.file('pic.png', new Uint8Array([137, 80, 78, 71, 1, 2]))
	zip.file('.obsidian/app.json', '{}')
	zip.file('.trash/deleted.md', '# gone\n')
	zip.file('stuff.canvas', '{}')
	zip.file('notes/bin.dat', new Uint8Array([0, 1]))
	zip.folder('emptyfolder')
	const blob = await zip.generateAsync({ type: 'blob' })
	return readVaultZip(new File([blob], 'vault.zip', { type: 'application/zip' }))
}

describe('importObsidianVault — IR shape', () => {
	it('produces folder pages first (including empty folders) then note pages', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: ['Old Page'] })

		const folders = ir.pages.filter((p) => p.isFolder)
		expect(folders.map((f) => f.title).sort()).toEqual(['emptyfolder', 'guides'])
		expect(folders.every((f) => f.contentYjsBase64 && f.plainText === '')).toBe(true)

		const notes = ir.pages.filter((p) => !p.isFolder)
		expect(notes.map((n) => n.title).sort()).toEqual(['Introduction', 'alpha', 'plain', 'root'])
	})

	it('maps frontmatter to title (winning over filename), properties and tags', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const intro = ir.pages.find((p) => p.title === 'Introduction')!
		expect(intro.properties).toMatchObject({ author: 'Harsh', tags: ['guide', 'import'] })
		expect(intro.tags).toEqual(['guide', 'import'])
		expect(intro.folderPath).toBe('guides')

		const alpha = ir.pages.find((p) => p.title === 'alpha')!
		expect(alpha.properties).toEqual({})
		expect(alpha.folderPath).toBe('guides')
	})

	it('sets folderPath null for root-level notes and seeds valid live-schema Yjs content', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const root = ir.pages.find((p) => p.title === 'root')!
		expect(root.folderPath).toBeNull()
		expect(root.contentYjsBase64.length).toBeGreaterThan(0)
		expect(root.plainText).toContain('[[alpha]]')
	})

	it('seeded content renders in a bound live editor (callout + heading preserved)', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const intro = ir.pages.find((p) => p.title === 'Introduction')!

		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(intro.contentYjsBase64))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		const html = editor.getHTML()
		expect(html).toContain('Intro')
		expect(html).toContain('data-callout')
		expect(html).toContain('Callout body')
		expect(html).toContain('<pre')
		expect(editor.getText()).toContain('[[alpha]]')
		editor.destroy()
	})

	it('prepends an empty title heading for bodies that do not start with a heading', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const plain = ir.pages.find((p) => p.title === 'plain')!
		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(plain.contentYjsBase64))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		expect(editor.getJSON().content?.[0]?.type).toBe('heading')
		expect(editor.getText()).toContain('Just body text')
		editor.destroy()
	})

	it('embeds images as base64 data-URL image nodes and degrades non-image embeds', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const root = ir.pages.find((p) => p.title === 'root')!

		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(root.contentYjsBase64))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		const html = editor.getHTML()
		expect(html).toContain('data:image/png;base64,')
		// degraded embed survives as a literal wikilink
		expect(editor.getText()).toContain('[[unknown.png]]')
		// base64 src does not leak into plain text
		expect(root.plainText).not.toContain('data:image')
		editor.destroy()
	})
})

describe('importObsidianVault — report', () => {
	it('counts pages, folder pages, resolved/unresolved links and degraded blocks', async () => {
		const vault = await fixtureVault()
		const { ir, report } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: ['Old Page'] })

		expect(report.pages).toBe(4)          // Introduction, alpha, plain, root
		expect(report.folderPages).toBe(2)    // guides, emptyfolder

		// Distinct link targets across all notes: alpha, Missing Note, Introduction, unknown.png
		// Resolved against imported titles {Introduction, alpha, plain, root} ∪ {Old Page}.
		expect(report.linksResolved).toBe(2)  // alpha, Introduction
		expect(report.linksUnresolved).toBe(2) // Missing Note, unknown.png

		expect(report.degradedBlocks).toBe(1) // ![[unknown.png]] → [[unknown.png]]
		expect(ir.pages.filter((p) => !p.isFolder)).toHaveLength(report.pages)
		expect(ir.pages.filter((p) => p.isFolder)).toHaveLength(report.folderPages)
	})
})

describe('importObsidianVault — image embed resolution', () => {
	async function imageVault(): Promise<Parameters<typeof importObsidianVault>[0]> {
		const zip = new JSZip()
		// Two images with the same basename in different folders (distinct bytes so
		// their base64 encodings differ: [1] → AQ==, [2] → Ag==).
		zip.file('a/logo.png', new Uint8Array([1]))
		zip.file('b/logo.png', new Uint8Array([2]))
		// Note in `a/` embedding by bare basename — should resolve to a/logo.png (note-relative).
		zip.file('a/note.md', ['---', 'title: Note A', '---', '# Note A', '', '![[logo.png]]', ''].join('\n'))
		// Note in `guides/` with no sibling logo — bare basename is ambiguous (two vault-wide matches), so it degrades.
		zip.file('guides/note.md', ['---', 'title: Note G', '---', '# Note G', '', '![[logo.png]]', ''].join('\n'))
		// Root note embedding by vault-relative path — should resolve exactly to a/logo.png.
		zip.file('root.md', ['---', 'title: RootImg', '---', '# RootImg', '', '![[a/logo.png]]', ''].join('\n'))
		const blob = await zip.generateAsync({ type: 'blob' })
		return readVaultZip(new File([blob], 'vault.zip', { type: 'application/zip' }))
	}

	async function renderHtml(page: ObsidianImportPage): Promise<string> {
		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(page.contentYjsBase64))
		const editor = new Editor({
			extensions: [...getSharedExtensions(), Collaboration.configure({ document: fresh })],
		})
		const html = editor.getHTML()
		editor.destroy()
		return html
	}

	it('resolves path-qualified embeds to the exact vault-relative image', async () => {
		const vault = await imageVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const root = ir.pages.find((p) => p.title === 'RootImg')!
		const html = await renderHtml(root)
		expect(html).toContain('data:image/png;base64,AQ==')
		expect(html).not.toContain('data:image/png;base64,Ag==')
	})

	it('resolves note-relative embeds to the image in the same folder over a duplicate basename', async () => {
		const vault = await imageVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const noteA = ir.pages.find((p) => p.title === 'Note A')!
		const html = await renderHtml(noteA)
		expect(html).toContain('data:image/png;base64,AQ==')
		expect(html).not.toContain('data:image/png;base64,Ag==')
	})

	it('degrades an ambiguous basename embed (no same-folder image) to a wikilink and reports it', async () => {
		const vault = await imageVault()
		const { ir, report } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const noteG = ir.pages.find((p) => p.title === 'Note G')!
		const html = await renderHtml(noteG)
		expect(html).not.toContain('data:image/png;base64')
		expect(noteG.plainText).toContain('[[logo.png]]')
		expect(report.degradedBlocks).toBe(1)
	})
})