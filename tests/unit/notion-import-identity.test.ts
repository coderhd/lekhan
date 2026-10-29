import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as Y from 'yjs'
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror'
import type { JSONContent } from '@tiptap/core'
import { markdownEngine, base64ToUint8Array } from '@/lib/markdown/engine'
import { importObsidianVault, type VaultContent } from '@/services/obsidian-import'
import { importNotionExport, readNotionZips, type NotionExportContent } from '@/services/notion-import'
import { vaultFingerprint } from '@/services/vault-import'
import type { ImportPage } from '@/services/import-ir'

function fixtureFile (relative: string): File {
	const buffer = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/notion', relative))
	return new File([new Uint8Array(buffer)], path.basename(relative), { type: 'application/zip' })
}

function docFromPage (page: ImportPage): JSONContent {
	const doc = new Y.Doc()
	Y.applyUpdate(doc, base64ToUint8Array(page.contentYjsBase64))
	const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default')) as JSONContent
	doc.destroy()
	return json
}

function safeFilename (title: string): string {
	return title.replace(/[\\/:*?"<>|]/g, '-')
}

/**
 * Re-import serialized pages through the Obsidian producer: the write-side IR
 * is producer-agnostic, so a Notion page that survives `serialize → parse`
 * unchanged must land with the same content hash.
 */
function reimportSerialized (pages: ImportPage[]) {
	const files = pages
		.filter(page => !page.isFolder)
		.map(page => {
			const markdown = markdownEngine.serializeExport(docFromPage(page))
			const frontmatter = `---\ntitle: ${JSON.stringify(page.title)}\n---\n`
			const filename = safeFilename(page.title)
			const filePath = page.folderPath ? `${page.folderPath}/${filename}.md` : `${filename}.md`
			return { path: filePath, data: new TextEncoder().encode(frontmatter + markdown) }
		})
	const directories = new Set<string>()
	for (const file of files) {
		const segments = file.path.split('/')
		for (let i = 1; i < segments.length; i++) directories.add(segments.slice(0, i).join('/'))
	}
	const content: VaultContent = { files, directories: [...directories] }
	return importObsidianVault(content, { workspaceId: 'ws-1', existingPageTitles: [] })
}

function nodeTypes (doc: JSONContent): Set<string> {
	const found = new Set<string>()
	const walk = (node: JSONContent) => {
		found.add(node.type ?? '')
		for (const child of node.content ?? []) walk(child)
	}
	walk(doc)
	return found
}

function notionContent (pages: Array<{ title: string; body: string }>): NotionExportContent {
	return {
		files: pages.map((page, index) => ({
			// A realistic UUID-suffixed name, distinct per page.
			path: `Seed Page ${index} ${String(index + 1).repeat(32).slice(0, 32)}.md`,
			data: new TextEncoder().encode(`# ${page.title}\n\n${page.body}`),
		})),
		directories: [],
		parts: 1,
		duplicatePagesSkipped: 0,
	}
}

describe('Notion IR identity — import → serialize → reimport', () => {
	it('preserves every imported page’s visible content and page count', async () => {
		const content = await readNotionZips([fixtureFile('basic-export.zip')])
		const first = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const second = reimportSerialized(first.ir.pages)

		const firstNotes = first.ir.pages.filter(page => !page.isFolder)
		const secondNotes = second.ir.pages.filter(page => !page.isFolder)
		expect(secondNotes.map(page => page.title).sort()).toEqual(firstNotes.map(page => page.title).sort())

		for (const page of firstNotes) {
			const roundTripped = secondNotes.find(candidate => candidate.title === page.title)!
			expect(roundTripped, `missing round-tripped page "${page.title}"`).toBeDefined()
			expect(roundTripped.plainText, `content changed for "${page.title}"`).toBe(page.plainText)
		}
	})

	it('keeps the suite constructs through serialize → reimport', async () => {
		const seeds = [
			{
				title: 'Headings and marks',
				body: [
					'## Section',
					'',
					'**bold** and *italic* and ***both***.',
					'',
					'### Deep heading',
					'',
					'> A quote with `inline code`.',
				].join('\n'),
			},
			{
				title: 'Lists',
				body: [
					'- bullet one',
					'- bullet two',
					'',
					'1. ordered one',
					'2. ordered two',
					'',
					'- [ ] open task',
					'- [x] done task',
				].join('\n'),
			},
			{
				title: 'Table',
				body: ['| Col A | Col B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n'),
			},
			{
				title: 'Code',
				body: ['```ts', 'const first = 1', '', 'const second = 2', '```', '', 'After the fence.'].join('\n'),
			},
			{
				title: 'Callout',
				body: '<table><tr><td>⚠️</td><td>Mind the gap<br>Second line</td></tr></table>',
			},
			{
				title: 'Links',
				body: 'See [Headings and marks](Seed%20Page%200%2011111111111111111111111111111111.md) and [[plain wikilink]].',
			},
		]

		const imported = importNotionExport(notionContent(seeds), {
			workspaceId: 'ws-1',
			existingPageTitles: [],
		})
		const roundTripped = reimportSerialized(imported.ir.pages)
		const expected = new Map(imported.ir.pages.filter(page => !page.isFolder).map(page => [page.title, page]))

		for (const page of roundTripped.ir.pages.filter(page => !page.isFolder)) {
			const original = expected.get(page.title)!
			expect(original, `unexpected page "${page.title}"`).toBeDefined()
			expect(page.plainText, `construct changed for "${page.title}"`).toBe(original.plainText)
		}

		const types = new Set<string>()
		for (const page of imported.ir.pages.filter(page => !page.isFolder)) {
			for (const type of nodeTypes(docFromPage(page))) types.add(type)
		}
		expect([...types]).toEqual(expect.arrayContaining([
			'heading', 'bulletList', 'orderedList', 'taskList', 'table', 'codeBlock', 'blockquote', 'callout',
		]))
	})

	it('is idempotent across a generated matrix of constructs', () => {
		// Deterministic pseudo-random generation (no fast-check dependency): 24
		// construct combinations that vary headings, tasks, quotes, tables, code
		// with blank lines, and marks.
		const rng = (seed: number) => {
			let state = seed >>> 0
			return () => {
				state = (state * 1664525 + 1013904223) >>> 0
				return state / 0x100000000
			}
		}
		const cases = Array.from({ length: 24 }, (_, index) => {
			const random = rng(index + 1)
			const blocks = [`## Generated ${index}`]
			if (random() > 0.3) blocks.push('', `- [${random() > 0.5 ? 'x' : ' '}] task ${index}`)
			if (random() > 0.4) blocks.push('', `> quote ${index}`)
			if (random() > 0.3) blocks.push('', `| k | v |\n| --- | --- |\n| ${index} | ${index * index} |`)
			if (random() > 0.2) blocks.push('', `\`\`\`ts\nconst n = ${index}\n\nconsole.log(n)\n\`\`\``)
			if (random() > 0.5) blocks.push('', `**bold ${index}** and *italic*`)
			return { title: `Generated ${index}`, body: blocks.join('\n') }
		})
		const imported = importNotionExport(notionContent(cases), {
			workspaceId: 'ws-1',
			existingPageTitles: [],
		})

		for (const page of imported.ir.pages.filter(page => !page.isFolder)) {
			const once = markdownEngine.serializeExport(docFromPage(page))
			const twice = markdownEngine.serializeExport(markdownEngine.parse(once))
			expect(twice, `serialization drifted for "${page.title}"`).toBe(once)
		}

		const roundTripped = reimportSerialized(imported.ir.pages)
		const originalByTitle = new Map(imported.ir.pages.filter(page => !page.isFolder).map(page => [page.title, page]))
		for (const page of roundTripped.ir.pages.filter(page => !page.isFolder)) {
			expect(page.plainText, `content drifted for "${page.title}"`).toBe(originalByTitle.get(page.title)?.plainText)
		}
	})

	it('is stable across identical ingestions and fingerprints may differ by producer', async () => {
		const content = await readNotionZips([fixtureFile('basic-export.zip')])
		const first = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const second = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })

		expect(first.ir.pages.map(page => page.contentYjsBase64)).toEqual(second.ir.pages.map(page => page.contentYjsBase64))
		expect(vaultFingerprint(first.ir)).toBe(vaultFingerprint(second.ir))
		// The producer is part of the retry identity: an identical page set from
		// a different source must not replay another source's landed batches.
		expect(vaultFingerprint(first.ir)).not.toBe(
			vaultFingerprint({ ...first.ir, source: 'obsidian' })
		)
	})
})
