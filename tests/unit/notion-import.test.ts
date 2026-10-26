import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { base64ToUint8Array, markdownEngine } from '@/lib/markdown/engine'
import {
	importNotionExport,
	readNotionZips,
	type NotionImportResult,
} from '@/services/notion-import'

function fixtureFile (relative: string): File {
	const buffer = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/notion', relative))
	return new File([new Uint8Array(buffer)], path.basename(relative), { type: 'application/zip' })
}

async function importBasic (existingPageTitles: string[] = []): Promise<NotionImportResult> {
	const content = await readNotionZips([fixtureFile('basic-export.zip')])
	return importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles })
}

function renderHtml (pageBase64: string): { html: string; text: string } {
	const doc = new Y.Doc()
	Y.applyUpdate(doc, base64ToUint8Array(pageBase64))
	const editor = new Editor({
		extensions: [...getSharedExtensions(), Collaboration.configure({ document: doc })],
	})
	const html = editor.getHTML()
	const text = editor.getText()
	editor.destroy()
	doc.destroy()
	return { html, text }
}

describe('importNotionExport — pages and hierarchy', () => {
	it('cleans UUID filenames, strips wrappers, and creates folder pages', async () => {
		const { ir, report } = await importBasic()

		const notes = ir.pages.filter(page => !page.isFolder)
		const titles = notes.map(page => page.title).sort()
		expect(titles).toEqual([
			'Backlog Item',
			'CSV Only Row',
			'Getting Started',
			'Product Docs',
			'Roadmap',
			'Setup Guide',
			'Ship Notion import',
			'Write fixtures',
		])
		expect(titles.every(title => !/[0-9a-f]{32}/i.test(title))).toBe(true)

		const folders = ir.pages.filter(page => page.isFolder)
		expect(folders.map(page => page.title).sort()).toEqual(['Product Docs', 'Tasks'])
		expect(folders.every(page => page.provenance?.source === 'notion')).toBe(true)
		expect(folders.find(page => page.title === 'Product Docs')?.folderPath).toBeNull()

		expect(ir.source).toBe('notion')
		expect(report.pages).toBe(8)
		expect(report.folderPages).toBe(2)
	})

	it('keeps per-producer provenance (source, path, block id, database origin)', async () => {
		const { ir } = await importBasic()
		const setup = ir.pages.find(page => page.title === 'Setup Guide')!
		expect(setup.provenance).toMatchObject({
			source: 'notion',
			sourcePath: 'Private & Shared/Product Docs 22222222222222222222222222222222/Setup Guide 33333333333333333333333333333333.md',
			blockId: '33333333333333333333333333333333',
		})

		const row = ir.pages.find(page => page.title === 'Ship Notion import')!
		expect(row.provenance?.database).toMatchObject({
			title: 'Tasks',
			titleColumn: 'Name',
		})
		expect(row.folderPath).toBe('Tasks')
	})

	it('does not duplicate the page title into the body', async () => {
		const { ir } = await importBasic()
		const gettingStarted = ir.pages.find(page => page.title === 'Getting Started')!
		const { text } = renderHtml(gettingStarted.contentYjsBase64)
		expect(text.match(/Getting Started/g)).toBeNull()
		expect(text).toContain('Callouts survive as callouts.')
	})
})

describe('importNotionExport — databases', () => {
	it('turns CSV rows into Pages carrying every CSV column as a property', async () => {
		const { ir, report } = await importBasic()
		const ship = ir.pages.find(page => page.title === 'Ship Notion import')!

		expect(report.databaseRows).toBe(4)
		expect(ship.properties).toEqual({
			Name: 'Ship Notion import',
			Status: 'Done, verified',
			Priority: 'High',
			Due: '2026-10-30',
			Formula: '2',
			Rollup: '9',
			Owner: 'Harsh',
		})
		// The row's own Markdown page supplied the body.
		expect(ship.plainText).toContain('S2 scope')
	})

	it('creates a row page from CSV columns even when Notion exported no Markdown file', async () => {
		const { ir } = await importBasic()
		const csvOnly = ir.pages.find(page => page.title === 'CSV Only Row')!
		expect(csvOnly.properties).toMatchObject({ Name: 'CSV Only Row', Status: 'Backlog', Owner: '' })
		expect(csvOnly.plainText.trim()).toBe('')
	})

	it('counts every exported CSV view but imports rows from _all.csv once', async () => {
		const { report } = await importBasic()
		expect(report.databaseViewsDeferred).toBe(2)
		const viewsLine = report.degradations?.find(line => line.kind === 'database-views')
		expect(viewsLine?.message).toContain('2 database views deferred to Lekhan databases (H2 #47)')
	})
})

describe('importNotionExport — links', () => {
	it('resolves relative UUID links, Notion URLs, and database links back to Page links', async () => {
		const { ir, report } = await importBasic()
		expect(report.linksResolved).toBe(5)
		expect(report.linksUnresolved).toBe(1)

		const gettingStarted = ir.pages.find(page => page.title === 'Getting Started')!
		expect(gettingStarted.plainText).toContain('[[Setup Guide]]')
		expect(gettingStarted.plainText).toContain('[[Roadmap|the roadmap]]')
		expect(gettingStarted.plainText).toContain('[[Ship Notion import]]')

		const roadmap = ir.pages.find(page => page.title === 'Roadmap')!
		expect(roadmap.plainText).toContain('[[Tasks|Tasks database]]')
	})

	it('keeps unresolvable links visible as unresolved Page links', async () => {
		const { ir } = await importBasic()
		const gettingStarted = ir.pages.find(page => page.title === 'Getting Started')!
		expect(gettingStarted.plainText).toContain('[[Missing Page|a missing page]]')
	})

	it('counts a link as resolved when it targets an existing workspace page', async () => {
		const { report } = await importBasic(['Missing Page'])
		expect(report.linksResolved).toBe(6)
		expect(report.linksUnresolved).toBe(0)
	})

	it('keeps raw and nested parentheses in link destinations', () => {
		const content = {
			files: [
				{ path: `Private & Shared/Raw (Q3) ${'a'.repeat(32)}.md`, data: new TextEncoder().encode('# Raw\n') },
				{ path: `Private & Shared/Nested ((Q3)) ${'c'.repeat(32)}.md`, data: new TextEncoder().encode('# Nested\n') },
				{ path: `Private & Shared/Encoded (Q3) ${'d'.repeat(32)}.md`, data: new TextEncoder().encode('# Encoded\n') },
				{
					path: `Private & Shared/Seed ${'b'.repeat(32)}.md`,
					data: new TextEncoder().encode([
						`[raw](Raw%20(Q3)%20${'a'.repeat(32)}.md)`,
						`[nested](Nested%20((Q3))%20${'c'.repeat(32)}.md)`,
						`[encoded](Encoded%20%28Q3%29%20${'d'.repeat(32)}.md)`,
					].join('\n\n')),
				},
			],
			directories: [],
			parts: 1,
			duplicatePagesSkipped: 0,
		} as Parameters<typeof importNotionExport>[0]
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const seed = ir.pages.find(page => page.title === 'Seed')!

		// A regex destination would stop at the first raw `)` and leave a
		// truncated target with no recoverable id; all three forms resolve here.
		expect(seed.plainText).toContain('[[Raw (Q3)|raw]]')
		expect(seed.plainText).toContain('[[Nested ((Q3))|nested]]')
		expect(seed.plainText).toContain('[[Encoded (Q3)|encoded]]')
		expect(report.linksResolved).toBe(3)
		expect(report.linksUnresolved).toBe(0)
	})

	it('keeps balanced parentheses in bare Notion URLs', () => {
		const content = {
			files: [
				{ path: `Private & Shared/Notes (Q3) ${'c'.repeat(32)}.md`, data: new TextEncoder().encode('# Notes\n') },
				{
					path: `Private & Shared/Seed ${'d'.repeat(32)}.md`,
					data: new TextEncoder().encode(`See (https://www.notion.so/Notes-(Q3)-${'c'.repeat(32)}).\n`),
				},
			],
			directories: [],
			parts: 1,
			duplicatePagesSkipped: 0,
		} as Parameters<typeof importNotionExport>[0]
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const seed = ir.pages.find(page => page.title === 'Seed')!

		expect(seed.plainText).toContain('[[Notes (Q3)]]')
		expect(seed.plainText).not.toContain('notion.so')
		expect(report.linksResolved).toBe(1)
	})
})

describe('importNotionExport — media, callouts and degradations', () => {
	it('embeds resolved images as data URLs and keeps visible alt text for broken ones', async () => {
		const { ir, report } = await importBasic()
		const gettingStarted = ir.pages.find(page => page.title === 'Getting Started')!
		const { html, text } = renderHtml(gettingStarted.contentYjsBase64)

		expect(html).toContain('data:image/png;base64,')
		expect(text).toContain('Missing screenshot')
		expect(text).not.toContain('data:image')
		expect(report.attachmentsDropped).toBe(2) // missing image + non-image PDF
	})

	it('keeps raw parentheses in image destinations', () => {
		const content = {
			files: [
				{ path: `Private & Shared/Seed ${'1'.repeat(32)}.md`, data: new TextEncoder().encode(`# Seed\n\n![Chart (Q3) shot](Chart%20(Q3)%20${'2'.repeat(32)}.png)\n`) },
				{ path: `Private & Shared/Chart (Q3) ${'2'.repeat(32)}.png`, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
			],
			directories: [],
			parts: 1,
			duplicatePagesSkipped: 0,
		} as Parameters<typeof importNotionExport>[0]
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const seed = ir.pages.find(page => page.title === 'Seed')!
		const { html } = renderHtml(seed.contentYjsBase64)

		expect(html).toContain('data:image/png;base64,')
		expect(report.attachmentsDropped).toBe(0)
	})

	it('converts Notion HTML callouts into native callouts', async () => {
		const { ir, report } = await importBasic()
		const gettingStarted = ir.pages.find(page => page.title === 'Getting Started')!
		const { html } = renderHtml(gettingStarted.contentYjsBase64)
		expect(html).toContain('data-callout')
		expect(html).toContain('Callouts survive as callouts.')
		expect(report.degradedBlocks).toBe(0)
	})

	it('converts only the genuine one-row/two-cell callout shape and keeps real HTML tables', async () => {
		const content = await readNotionZips([fixtureFile('html-tables.zip')])
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const page = ir.pages.find(candidate => candidate.title === 'Tables')!
		const { html, text } = renderHtml(page.contentYjsBase64)

		// Notion's callout (short icon + text) still becomes a native callout.
		expect(html).toContain('data-callout')
		expect(text.match(/Callouts survive as callouts\./g)).toHaveLength(1)
		// A 3-cell row and a 2×2 table are real tables: every cell survives and
		// neither is collapsed into a callout body (QA B1).
		for (const cell of ['Col A', 'Col B', 'Col C', 'r1a', 'r1b', 'r2a', 'r2b']) {
			expect(text).toContain(cell)
		}
		expect(html.match(/<table/g)).toHaveLength(2)
		// Both are named as unrepresentable HTML rather than silently flattened.
		expect(report.degradedBlocks).toBe(2)
	})

	it('preserves code blocks, tables and task lists', async () => {
		const { ir } = await importBasic()
		const setup = ir.pages.find(page => page.title === 'Setup Guide')!
		const { html } = renderHtml(setup.contentYjsBase64)
		expect(html).toContain('<pre')
		expect(html).toContain('<table')
		expect(html).toContain('data-type="taskList"')
		expect(html).toContain('data-checked="true"')
	})

	it('flattens synced-block markers and names every silent-loss category', async () => {
		const { ir, report } = await importBasic()
		const gettingStarted = ir.pages.find(page => page.title === 'Getting Started')!

		expect(gettingStarted.plainText).toContain('Synced text shared from another page.')
		expect(gettingStarted.plainText).not.toContain('synced_block')
		expect(report.syncedBlocksFlattened).toBe(1)

		const messages = (report.degradations ?? []).map(line => line.message).join('\n')
		expect(messages).toContain('synced block')
		expect(messages).toContain('comments')
		expect(messages).toContain('Formula and rollup columns')
		expect(messages).toContain('attachments')
	})
})

describe('importNotionExport — database layout variants', () => {
	it('matches row pages when the CSV is a sibling or the nested folder, with no duplicates or wrapper pages', async () => {
		const content = await readNotionZips([fixtureFile('database-layouts.zip')])
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })

		const notes = ir.pages.filter(page => !page.isFolder)
		expect(notes.map(page => page.title).sort()).toEqual(['Alpha', 'Beta', 'Gamma'])
		expect(report.databaseRows).toBe(3)
		expect(report.databaseViewsDeferred).toBe(2)
		expect(report.folderPages).toBe(3) // Projects, Product, Product/Tasks

		// Exactly one row page per row, with both the body and the CSV columns.
		const alpha = notes.filter(page => page.title === 'Alpha')
		expect(alpha).toHaveLength(1)
		expect(alpha[0].properties).toMatchObject({ Name: 'Alpha', Status: 'Active' })
		expect(alpha[0].plainText).toContain('Alpha body.')

		const gamma = notes.find(page => page.title === 'Gamma')!
		expect(gamma.properties).toMatchObject({ Name: 'Gamma', Status: 'Done' })
		expect(gamma.plainText).toContain('Gamma body.')

		expect(ir.pages.some(page => /Private & Shared/i.test(page.title))).toBe(false)
	})

	it('parses two sibling databases that share one folder instead of collapsing them', async () => {
		const content = await readNotionZips([fixtureFile('sibling-databases.zip')])
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })

		const notes = ir.pages.filter(page => !page.isFolder)
		// Beta has no Markdown row file: her CSV row still becomes a Page.
		expect(notes.map(page => page.title).sort()).toEqual(['Alpha', 'Beta', 'One'])
		expect(report.databaseRows).toBe(3)
		expect(report.databaseViewsDeferred).toBe(3) // two Projects views + Tasks
		expect(ir.pages.filter(page => page.isFolder).map(page => page.title).sort()).toEqual(['Projects', 'Tasks', 'Workspace'])

		// `_all.csv` wins for Projects; the view-only CSV has no Owner column.
		const alpha = notes.find(page => page.title === 'Alpha')!
		expect(alpha.properties).toMatchObject({ Name: 'Alpha', Status: 'Active', Owner: 'Ada' })
		expect(alpha.plainText).toContain('Alpha body.')
		// The second database in the same directory was parsed, not dropped.
		const one = notes.find(page => page.title === 'One')!
		expect(one.properties).toMatchObject({ Name: 'One', Due: '2026-01-02' })
		expect(one.folderPath).toBe('Workspace/Tasks')
	})

	it('does not consume a normal page beside a nested database CSV as a row', () => {
		const content = {
			files: [
				{
					path: `Private & Shared/Product ${'9'.repeat(32)}/Overview ${'a'.repeat(32)}.md`,
					data: new TextEncoder().encode('---\nauthor: me\n---\n# Overview\n\nA real page.\n'),
				},
				{
					path: `Private & Shared/Product ${'9'.repeat(32)}/Tasks ${'b'.repeat(32)}.csv`,
					data: new TextEncoder().encode('Name,Status\nOverview,Active\n'),
				},
			],
			directories: [],
			parts: 1,
			duplicatePagesSkipped: 0,
		} as Parameters<typeof importNotionExport>[0]
		const { ir } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })

		const overviewPages = ir.pages.filter(page => !page.isFolder && page.title === 'Overview')
		expect(overviewPages).toHaveLength(2)
		// The real page keeps its frontmatter; the CSV row is a separate page
		// under the database folder with the CSV columns.
		expect(overviewPages.find(page => page.folderPath === 'Product')?.properties).toMatchObject({ author: 'me' })
		expect(overviewPages.find(page => page.folderPath === 'Product/Tasks')?.properties).toMatchObject({
			Name: 'Overview',
			Status: 'Active',
		})
	})
})

describe('importNotionExport — code safety and unrepresentable titles', () => {
	function contentOf (files: Record<string, string>) {
		return {
			files: Object.entries(files).map(([filePath, body]) => ({
				path: filePath,
				data: new TextEncoder().encode(body),
			})),
			directories: [],
			parts: 1,
			duplicatePagesSkipped: 0,
		}
	}

	it('never rewrites links or images inside fenced and inline code', async () => {
		const content = contentOf({
			[`Other ${'5'.repeat(32)}.md`]: '# Other\n\nTarget.\n',
			[`Seed ${'1'.repeat(32)}.md`]: [
				'# Seed',
				'',
				'```md',
				'[Not a link](Other.md)',
				'![Not an image](pic.png)',
				'<table><tr><td>x</td><td>y</td></tr></table>',
				'```',
				'',
				'Inline `[also not a link](Other.md)` and `![no](pic.png)` stay literal.',
			].join('\n'),
		}) as Parameters<typeof importNotionExport>[0]
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const page = ir.pages.find(candidate => candidate.title === 'Seed')!

		expect(page.plainText).toContain('[Not a link](Other.md)')
		expect(page.plainText).toContain('![Not an image](pic.png)')
		expect(page.plainText).toContain('[also not a link](Other.md)')
		expect(page.plainText).toContain('<table><tr><td>x</td><td>y</td></tr></table>')
		expect(page.plainText).not.toContain('[[Other]]')
		expect(page.plainText).not.toContain('[!note]')
		expect(report.attachmentsDropped).toBe(0)
		expect(report.degradedBlocks).toBe(0)
	})

	it('keeps link labels with inline code and resolves multi-line HTML images', () => {
		const content = contentOf({
			[`Other ${'6'.repeat(32)}.md`]: '# Other\n\nTarget.\n',
			[`Seed ${'7'.repeat(32)}.md`]: [
				'# Seed',
				'',
				'See [`v2` docs](Other%2066666666666666666666666666666666.md) and more text.',
				'',
				'<img',
				'  src="missing-illustration.png"',
				'  alt="missing diagram"',
				'/>',
			].join('\n'),
		}) as Parameters<typeof importNotionExport>[0]
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const page = ir.pages.find(candidate => candidate.title === 'Seed')!

		expect(page.plainText).toContain('[[Other|v2 docs]] and more text.')
		expect(page.plainText).toContain('missing diagram')
		expect(report.attachmentsDropped).toBe(1)
	})

	it('keeps text (and reports the degradation) for any title wikilink syntax cannot encode', () => {
		const content = contentOf({
			[`B | C ${'2'.repeat(32)}.md`]: '# B | C\n\nBody.\n',
			[`Roadmap [beta ${'8'.repeat(32)}.md`]: '# Roadmap [beta\n\nBody.\n',
			[`Source ${'3'.repeat(32)}.md`]: [
				'# Source',
				'',
				`Read [the b page](B%20%7C%20C%20${'2'.repeat(32)}.md).`,
				`Read [the beta](Roadmap%20%5Bbeta%20${'8'.repeat(32)}.md).`,
			].join('\n'),
		}) as Parameters<typeof importNotionExport>[0]
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const source = ir.pages.find(page => page.title === 'Source')!

		expect(source.plainText).toContain('the b page')
		expect(source.plainText).toContain('the beta')
		expect(source.plainText).not.toContain('[[B |')
		expect(source.plainText).not.toContain('[[Roadmap [')
		expect(report.degradedBlocks).toBe(2)
	})

	it('drops executable link schemes instead of importing them', () => {
		const content = contentOf({
			[`Seed ${'4'.repeat(32)}.md`]: '# Seed\n\n[click me](javascript:alert(1))\n',
		}) as Parameters<typeof importNotionExport>[0]
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const page = ir.pages.find(candidate => candidate.title === 'Seed')!

		expect(page.plainText).toContain('click me')
		expect(page.plainText).not.toContain('javascript:')
		expect(report.degradedBlocks).toBe(1)
	})

	it('does not end a longer fence at a nested shorter fence', () => {
		const content = contentOf({
			[`Other ${'c'.repeat(32)}.md`]: '# Other\n\nTarget.\n',
			[`Seed ${'d'.repeat(32)}.md`]: [
				'# Seed',
				'',
				'````markdown',
				'```js',
				'[inside](Other.md)',
				'```',
				'````',
				'',
				`[real](Other%20${'c'.repeat(32)}.md)`,
			].join('\n'),
		}) as Parameters<typeof importNotionExport>[0]
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const page = ir.pages.find(candidate => candidate.title === 'Seed')!

		expect(page.plainText).toContain('[inside](Other.md)')
		expect(page.plainText).toContain('[[Other|real]]')
		expect(report.linksResolved).toBe(1)
	})

	it('resolves links whose label contains nested brackets and reports the alias change', () => {
		const content = contentOf({
			[`Other ${'e'.repeat(32)}.md`]: '# Other\n\nTarget.\n',
			[`Seed ${'f'.repeat(32)}.md`]: `# Seed\n\nSee [Array[0] notes](Other%20${'e'.repeat(32)}.md).\n`,
		}) as Parameters<typeof importNotionExport>[0]
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const page = ir.pages.find(candidate => candidate.title === 'Seed')!

		expect(page.plainText).toContain('[[Other|Array0 notes]]')
		expect(report.linksResolved).toBe(1)
		expect(report.degradedBlocks).toBe(1)
	})

	it('keeps the alt text of a missing image whose alt contains brackets', () => {
		const content = contentOf({
			[`Seed ${'1'.repeat(32)}.md`]: '# Seed\n\n![Array[0] shot](missing.png)\n',
		}) as Parameters<typeof importNotionExport>[0]
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })
		const page = ir.pages.find(candidate => candidate.title === 'Seed')!

		expect(page.plainText).toContain('Array[0] shot')
		expect(report.attachmentsDropped).toBe(1)
	})

	it('reports an empty export as empty rather than "not a Notion export"', () => {
		expect(() =>
			importNotionExport(
				{ files: [], directories: [], parts: 1, duplicatePagesSkipped: 0 },
				{ workspaceId: 'ws-1', existingPageTitles: [] }
			)
		).toThrow(/No Notion pages or database rows/i)
	})
})

describe('importNotionExport — multi-part exports', () => {
	it('merges parts, skips duplicate pages, and reports the part count', async () => {
		const content = await readNotionZips([
			fixtureFile('multi-part/part-1.zip'),
			fixtureFile('multi-part/part-2.zip'),
		])
		const { ir, report } = importNotionExport(content, { workspaceId: 'ws-1', existingPageTitles: [] })

		expect(ir.pages.map(page => page.title).sort()).toEqual(['Part One', 'Part Two', 'Shared Page'])
		expect(report.exportParts).toBe(2)
		expect(report.duplicatePagesSkipped).toBe(1)
		expect(report.linksResolved).toBe(1) // Part One → Part Two
		expect(report.degradations?.some(line => line.kind === 'duplicate-pages')).toBe(true)
	})
})

describe('importNotionExport — safety envelope', () => {
	it('rejects an over-limit export before converting any page body', () => {
		const files = Array.from({ length: 2001 }, (_, index) => ({
			path: `Private & Shared/Page ${index} ${index.toString(16).padStart(32, '0')}.md`,
			data: new TextEncoder().encode('# Page\n\nbody\n'),
		}))
		const seed = vi.spyOn(markdownEngine, 'seedToYjsBase64')

		expect(() =>
			importNotionExport(
				{ files, directories: [], parts: 1, duplicatePagesSkipped: 0 },
				{ workspaceId: 'ws-1', existingPageTitles: [] }
			)
		).toThrow(/maximum of 2000 pages/)
		// The guard runs before per-page body processing and Yjs conversion.
		expect(seed).not.toHaveBeenCalled()
		seed.mockRestore()
	})
})
