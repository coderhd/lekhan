import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import {
	cleanNotionPath,
	importNotionExport,
	normalizeNotionId,
	parseCsv,
	readNotionZips,
	stripNotionId,
} from '@/services/notion-import'

function fixtureFile (relative: string): File {
	const buffer = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/notion', relative))
	return new File([new Uint8Array(buffer)], path.basename(relative), { type: 'application/zip' })
}

describe('Notion name cleaning', () => {
	it('strips the trailing 32-hex id while keeping the extension', () => {
		expect(stripNotionId('Roadmap 2f1c9a0b4d6e48f7a1b2c3d4e5f60718.md')).toBe('Roadmap.md')
		expect(stripNotionId('Product Docs 2f1c9a0b4d6e48f7a1b2c3d4e5f60718')).toBe('Product Docs')
	})

	it('cleans every path segment and drops the export wrapper', () => {
		expect(
			cleanNotionPath(
				'Private & Shared/Product Docs 2f1c9a0b4d6e48f7a1b2c3d4e5f60718/Setup 11111111111111111111111111111111.md'
			)
		).toBe('Product Docs/Setup.md')
		expect(cleanNotionPath('Export-Part-1/Part One cccccccccccccccccccccccccccccccc.md')).toBe('Part One.md')
	})

	it('normalizes dashed and undashed ids', () => {
		expect(normalizeNotionId('2f1c9a0b-4d6e-48f7-a1b2-c3d4e5f60718')).toBe('2f1c9a0b4d6e48f7a1b2c3d4e5f60718')
		expect(normalizeNotionId('2f1c9a0b4d6e48f7a1b2c3d4e5f60718')).toBe('2f1c9a0b4d6e48f7a1b2c3d4e5f60718')
	})
})

describe('parseCsv (RFC 4180)', () => {
	it('handles quoted commas, escaped quotes, embedded newlines and BOM', () => {
		const rows = parseCsv('\ufeffName,Status,Notes\r\n"Ship, it","Done ""yes""","line one\nline two"\r\n')
		expect(rows).toEqual([
			['Name', 'Status', 'Notes'],
			['Ship, it', 'Done "yes"', 'line one\nline two'],
		])
	})

	it('treats a stray mid-cell quote as literal data instead of swallowing the file', () => {
		expect(parseCsv('a"b,c\nnext,row\n')).toEqual([
			['a"b', 'c'],
			['next', 'row'],
		])
	})
})

describe('readNotionZips', () => {
	it('enumerates pages, database CSVs and images; skips archive junk', async () => {
		const content = await readNotionZips([fixtureFile('basic-export.zip')])
		const paths = content.files.map(file => file.path)

		expect(paths).toContain('Private & Shared/Getting Started 11111111111111111111111111111111.md')
		expect(paths).toContain('Private & Shared/Tasks 77777777777777777777777777777777/Tasks 77777777777777777777777777777777_all.csv')
		expect(paths.some(file => file.endsWith('architecture 66666666666666666666666666666666.png'))).toBe(true)
		expect(paths.some(file => file.includes('__MACOSX'))).toBe(false)
		expect(paths.some(file => file.endsWith('.DS_Store'))).toBe(false)
		expect(content.parts).toBe(1)
		expect(content.duplicatePagesSkipped).toBe(0)
	})

	it('merges multi-part exports and skips a page that appears in both parts', async () => {
		const content = await readNotionZips([
			fixtureFile('multi-part/part-1.zip'),
			fixtureFile('multi-part/part-2.zip'),
		])
		expect(content.parts).toBe(2)
		expect(content.duplicatePagesSkipped).toBe(1)
		const titles = content.files
			.filter(file => file.path.endsWith('.md'))
			.map(file => file.path)
		expect(titles).toHaveLength(3)
	})

	it('does not treat a non-Notion zip as an importable export', () => {
		expect(() =>
			importNotionExport(
				{ files: [{ path: 'notes/a.md', data: new TextEncoder().encode('# A') }], directories: [], parts: 1, duplicatePagesSkipped: 0 },
				{ workspaceId: 'ws-1', existingPageTitles: [] }
			)
		).toThrow(/doesn't look like a Notion export/i)
	})

	it('rejects an empty selection', async () => {
		await expect(readNotionZips([])).rejects.toThrow(/Select a Notion export/i)
	})

	it('rejects a file that exceeds the per-file unpacked size limit before decompressing', async () => {
		const zip = new JSZip()
		zip.file(`Big ${'1'.repeat(32)}.md`, 'x'.repeat(10 * 1024 * 1024 + 1))
		const blob = await zip.generateAsync({ type: 'nodebuffer' })
		const file = new File([new Uint8Array(blob)], 'big.zip', { type: 'application/zip' })
		await expect(readNotionZips([file])).rejects.toThrow(/per-file limit/i)
	})

	it('enforces one image budget across every selected export part', async () => {
		async function imagesZip (prefix: string, count: number): Promise<File> {
			const zip = new JSZip()
			for (let i = 0; i < count; i++) {
				zip.file(`${prefix}/image ${i} ${String(i).padStart(32, '0')}.png`, new Uint8Array([1, 2, 3]))
			}
			const blob = await zip.generateAsync({ type: 'nodebuffer' })
			return new File([new Uint8Array(blob)], `${prefix}.zip`, { type: 'application/zip' })
		}
		await expect(readNotionZips([
			await imagesZip('part-1', 600),
			await imagesZip('part-2', 401),
		])).rejects.toThrow(/maximum number of image attachments/i)
	})
})
