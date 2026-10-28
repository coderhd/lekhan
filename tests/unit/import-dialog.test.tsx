import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ImportDialog } from '@/components/import-dialog'

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getSession: vi.fn(async () => ({
				data: { session: { access_token: 'test-token' } },
				error: null,
			})),
		},
	},
}))

const importObsidianVaultMock = vi.hoisted(() => vi.fn())
const readVaultZipMock = vi.hoisted(() => vi.fn())
const readVaultFilesMock = vi.hoisted(() => vi.fn())
const pickVaultDirectoryMock = vi.hoisted(() => vi.fn())
const readNotionZipsMock = vi.hoisted(() => vi.fn())
const importNotionExportMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/obsidian-import', () => ({
	readVaultZip: readVaultZipMock,
	readVaultFiles: readVaultFilesMock,
	readVaultDirectory: vi.fn(),
	pickVaultDirectory: pickVaultDirectoryMock,
	importObsidianVault: importObsidianVaultMock,
}))

vi.mock('@/services/notion-import', () => ({
	readNotionZips: readNotionZipsMock,
	importNotionExport: importNotionExportMock,
}))

// Minimal IR/report fixture the ingestion mock returns.
const fixtureReport = {
	pages: 2,
	folderPages: 1,
	linksResolved: 3,
	linksUnresolved: 1,
	degradedBlocks: 2,
}
const fixtureIR = {
	workspaceId: 'ws-1',
	pages: [
		{
			title: 'Note A', folderPath: null, properties: {}, tags: [],
			contentYjsBase64: Buffer.from('a').toString('base64'),
			plainText: 'a', isFolder: false, contentHash: 'hash-note-a',
		},
		{
			title: 'Note B', folderPath: null, properties: {}, tags: [],
			contentYjsBase64: Buffer.from('b').toString('base64'),
			plainText: 'b', isFolder: false, contentHash: 'hash-note-b',
		},
	],
}

function makeZipFile () {
	return new File([new Uint8Array([1, 2, 3])], 'vault.zip', { type: 'application/zip' })
}

async function openDialogAndPickZip (handlers?: { onOpenPage?: (id: string) => void }) {
	render(
		<ImportDialog
			open
			onOpenChange={() => {}}
			getWorkspace={async () => ({ id: 'ws-1' })}
			existingPageTitles={['Existing']}
			onMarkdownFile={() => {}}
			onOpenPage={handlers?.onOpenPage ?? (() => {})}
		/>
	)
	fireEvent.click(screen.getByText('Obsidian vault (.zip)'))
	const input = document.querySelector('input[type="file"][accept=".zip"]') as HTMLInputElement
	fireEvent.change(input, { target: { files: [makeZipFile()] } })
	await waitFor(() => expect(screen.queryByTestId('import-progress')).not.toBeTruthy())
}

describe('ImportDialog', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		global.fetch = vi.fn()
	})

	it('shows the three source options on open', () => {
		render(
			<ImportDialog
				open
				onOpenChange={() => {}}
				getWorkspace={async () => ({ id: 'ws-1' })}
				existingPageTitles={[]}
				onMarkdownFile={() => {}}
				onOpenPage={() => {}}
			/>
		)
		expect(screen.getByText('Obsidian vault (.zip)')).toBeTruthy()
		expect(screen.getByText('Obsidian vault (folder)')).toBeTruthy()
		expect(screen.getByText('Single Markdown file')).toBeTruthy()
	})

	it('routes a markdown file selection to onMarkdownFile and closes', async () => {
		const onMarkdownFile = vi.fn()
		const onOpenChange = vi.fn()
		render(
			<ImportDialog
				open
				onOpenChange={onOpenChange}
				getWorkspace={async () => ({ id: 'ws-1' })}
				existingPageTitles={[]}
				onMarkdownFile={onMarkdownFile}
				onOpenPage={() => {}}
			/>
		)
		fireEvent.click(screen.getByText('Single Markdown file'))
		const input = document.querySelector('input[accept=".md,.markdown,.mdown,.txt"]') as HTMLInputElement
		const file = new File(['# hello'], 'note.md', { type: 'text/markdown' })
		fireEvent.change(input, { target: { files: [file] } })
		await waitFor(() => expect(onMarkdownFile).toHaveBeenCalledWith(file))
	})

	it('ingests a zip, writes to /api/import, and renders the honest report card', async () => {
		readVaultZipMock.mockResolvedValue({
			files: [{ path: 'a.md', data: new Uint8Array([104, 105]) }],
			directories: [],
		})
		importObsidianVaultMock.mockReturnValue({ ir: fixtureIR, report: fixtureReport })
		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({
				success: true,
				importedCount: 2,
				pages: [{ id: 'p-1', title: 'Note A' }, { id: 'p-2', title: 'Note B' }],
				warnings: [],
			}), { status: 200, headers: { 'Content-Type': 'application/json' } })
		)
		global.fetch = fetchMock as unknown as typeof global.fetch

		const onOpenPage = vi.fn()
		await openDialogAndPickZip({ onOpenPage })

		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
		expect((init.headers as Record<string, string>).Authorization).toContain('Bearer ')
		const sentBody = JSON.parse(String(init.body))
		expect(sentBody.workspaceId).toBe('ws-1')
		expect(sentBody.pages).toHaveLength(2)

		expect(await screen.findByTestId('import-report')).toBeTruthy()
		expect(screen.getByTestId('report-pages').textContent).toContain('2 pages created')
		expect(screen.getByTestId('report-links').textContent).toContain('3 links resolved')
		expect(screen.getByTestId('report-unresolved').textContent).toContain("don't exist yet")
		expect(screen.getByTestId('report-degraded').textContent).toContain('2 blocks')

		fireEvent.click(screen.getByText('Note A'))
		await waitFor(() => expect(onOpenPage).toHaveBeenCalledWith('p-1'))
	})

	it('shows the no-markdown-notes error for an empty vault without calling the API', async () => {
		readVaultZipMock.mockResolvedValue({
			files: [{ path: 'image.png', data: new Uint8Array([1]) }],
			directories: ['attachments'],
		})
		const fetchMock = vi.fn()
		global.fetch = fetchMock as unknown as typeof global.fetch

		await openDialogAndPickZip()

		expect(await screen.findByTestId('import-error')).toBeTruthy()
		expect(screen.getByText(/No markdown notes found/i)).toBeTruthy()
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('surfaces server errors with a Try again path', async () => {
		readVaultZipMock.mockResolvedValue({
			files: [{ path: 'a.md', data: new Uint8Array([104, 105]) }],
			directories: [],
		})
		importObsidianVaultMock.mockReturnValue({ ir: fixtureIR, report: fixtureReport })
		global.fetch = vi.fn(async () => new Response(
			JSON.stringify({ error: 'Forbidden: Only the workspace owner can import' }),
			{ status: 403, headers: { 'Content-Type': 'application/json' } }
		)) as unknown as typeof global.fetch

		await openDialogAndPickZip()

		expect(await screen.findByTestId('import-error')).toBeTruthy()
		expect(screen.getByText(/Only the workspace owner/i)).toBeTruthy()
		expect(screen.getByText('Try again')).toBeTruthy()
	})

	it('lists server-side warnings (snapshot/index failures) in the report', async () => {
		readVaultZipMock.mockResolvedValue({
			files: [{ path: 'a.md', data: new Uint8Array([104, 105]) }],
			directories: [],
		})
		importObsidianVaultMock.mockReturnValue({ ir: fixtureIR, report: fixtureReport })
		global.fetch = vi.fn(async () => new Response(JSON.stringify({
			success: true,
			importedCount: 1,
			pages: [{ id: 'p-1', title: 'Note A' }],
			warnings: [{ title: 'Note B', stage: 'snapshot', error: 'storage down' }],
		}), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof global.fetch

		await openDialogAndPickZip()

		const warnings = await screen.findByTestId('report-warnings')
		expect(warnings.textContent).toContain('Note B')
		expect(warnings.textContent).toContain('storage down')
	})

	it('reuses the same clientImportId when retrying a failed import, and reports resumed pages (#87)', async () => {
		readVaultZipMock.mockResolvedValue({
			files: [{ path: 'a.md', data: new Uint8Array([104, 105]) }],
			directories: [],
		})
		// Simulate real re-ingestion: each run re-encodes Yjs with a fresh random
		// clientID, so the encoded bytes differ. The attempt-session id must still
		// be reused (fingerprint is content-based, not Yjs-byte based).
		let ingest = 0
		importObsidianVaultMock.mockImplementation(() => {
			ingest += 1
			const pages = fixtureIR.pages.map(page => ({
				...page,
				contentYjsBase64: 'A'.repeat(ingest * 8),
			}))
			return { ir: { ...fixtureIR, pages }, report: fixtureReport }
		})

		let call = 0
		const fetchMock = vi.fn(async () => {
			call += 1
			if (call === 1) {
				return new Response(JSON.stringify({ error: 'batch 2 exploded' }), {
					status: 500, headers: { 'Content-Type': 'application/json' },
				})
			}
			return new Response(JSON.stringify({
				success: true,
				resumed: true,
				importedCount: 2,
				pages: [{ id: 'p-1', title: 'Note A' }, { id: 'p-2', title: 'Note B' }],
				warnings: [],
			}), { status: 200, headers: { 'Content-Type': 'application/json' } })
		})
		global.fetch = fetchMock as unknown as typeof global.fetch

		render(
			<ImportDialog
				open
				onOpenChange={() => {}}
				getWorkspace={async () => ({ id: 'ws-1' })}
				existingPageTitles={[]}
				onMarkdownFile={() => {}}
				onOpenPage={() => {}}
			/>
		)

		const pickZip = async () => {
			fireEvent.click(screen.getByText('Obsidian vault (.zip)'))
			const input = document.querySelector('input[type="file"][accept=".zip"]') as HTMLInputElement
			fireEvent.change(input, { target: { files: [makeZipFile()] } })
			await waitFor(() => expect(screen.queryByTestId('import-progress')).not.toBeTruthy())
		}

		await pickZip()
		expect(await screen.findByTestId('import-error')).toBeTruthy()

		fireEvent.click(screen.getByText('Try again'))
		await pickZip()

		expect(await screen.findByTestId('import-report')).toBeTruthy()
		expect(fetchMock).toHaveBeenCalledTimes(2)

		const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
		const first = JSON.parse(String(calls[0][1].body))
		const second = JSON.parse(String(calls[1][1].body))
		expect(first.clientImportId).toBeTruthy()
		expect(second.clientImportId).toBe(first.clientImportId)
		expect(second.batchIndex).toBe(0)
		expect(screen.getByTestId('report-resumed').textContent).toContain('already imported')
	})

	it('offers the Notion export path with export-queue expectations', () => {
		render(
			<ImportDialog
				open
				onOpenChange={() => {}}
				getWorkspace={async () => ({ id: 'ws-1' })}
				existingPageTitles={[]}
				onMarkdownFile={() => {}}
				onOpenPage={() => {}}
			/>
		)
		expect(screen.getByText('Notion export (.zip)')).toBeTruthy()
		expect(screen.getByText(/Markdown & CSV/)).toBeTruthy()
		expect(screen.getByText(/expire after 7 days/)).toBeTruthy()
		expect(screen.getByText(/no Notion API/i)).toBeTruthy()
	})

	it('imports multi-part Notion zips through the same writer and renders honest degradations', async () => {
		readNotionZipsMock.mockResolvedValue({
			files: [],
			directories: [],
			parts: 2,
			duplicatePagesSkipped: 0,
		})
		importNotionExportMock.mockReturnValue({
			ir: {
				workspaceId: 'ws-1',
				source: 'notion',
				pages: [
					{
						title: 'Getting Started', folderPath: null, properties: {}, tags: [],
						contentYjsBase64: Buffer.from('a').toString('base64'),
						plainText: 'a', isFolder: false, contentHash: 'hash-notion-a',
					},
					{
						title: 'Tasks', folderPath: null, properties: {}, tags: [],
						contentYjsBase64: Buffer.from('b').toString('base64'),
						plainText: 'b', isFolder: true, contentHash: 'hash-notion-b',
					},
				],
			},
			report: {
				source: 'notion',
				pages: 1,
				folderPages: 1,
				linksResolved: 2,
				linksUnresolved: 1,
				degradedBlocks: 0,
				databaseViewsDeferred: 1,
				databaseRows: 2,
				syncedBlocksFlattened: 0,
				commentsOmitted: true,
				formulasRollupsFlattened: true,
				attachmentsDropped: 1,
				exportParts: 2,
				duplicatePagesSkipped: 0,
				degradations: [
					{ kind: 'database-views', count: 1, message: '1 database view deferred to Lekhan databases (H2 #47)' },
					{ kind: 'attachments', count: 1, message: '1 non-image attachment was dropped' },
					{ kind: 'comments', count: 0, message: 'Notion comments are not included in a Markdown & CSV export' },
					{ kind: 'formulas-rollups', count: 0, message: 'Formula and rollup columns arrived as static values' },
				],
			},
		})
		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({
				success: true,
				importedCount: 2,
				pages: [{ id: 'p-1', title: 'Getting Started' }, { id: 'p-2', title: 'Tasks' }],
				warnings: [],
			}), { status: 200, headers: { 'Content-Type': 'application/json' } })
		)
		global.fetch = fetchMock as unknown as typeof global.fetch

		render(
			<ImportDialog
				open
				onOpenChange={() => {}}
				getWorkspace={async () => ({ id: 'ws-1' })}
				existingPageTitles={[]}
				onMarkdownFile={() => {}}
				onOpenPage={() => {}}
			/>
		)

		fireEvent.click(screen.getByText('Notion export (.zip)'))
		const input = screen.getByTestId('notion-zip-input') as HTMLInputElement
		const partOne = new File([new Uint8Array([1])], 'part-1.zip', { type: 'application/zip' })
		const partTwo = new File([new Uint8Array([2])], 'part-2.zip', { type: 'application/zip' })
		fireEvent.change(input, { target: { files: [partOne, partTwo] } })

		await waitFor(() => expect(screen.queryByTestId('import-progress')).not.toBeTruthy())

		expect(readNotionZipsMock).toHaveBeenCalledWith([partOne, partTwo])
		expect(importNotionExportMock).toHaveBeenCalledWith(
			expect.objectContaining({ parts: 2 }),
			expect.objectContaining({ workspaceId: 'ws-1' })
		)
		// The only network call is our own writer; no Notion API is involved.
		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
		const sentBody = JSON.parse(String(init.body))
		expect(sentBody.source).toBe('notion')
		expect(sentBody.pages).toHaveLength(2)

		expect(await screen.findByTestId('report-degradations')).toBeTruthy()
		expect(screen.getByTestId('degradation-database-views').textContent).toContain('deferred to Lekhan databases (H2 #47)')
		expect(screen.getByTestId('degradation-attachments').textContent).toContain('non-image attachment')
	})

	it('snapshots Notion files before clearing the input (browsers empty FileList on value reset)', async () => {
		readNotionZipsMock.mockResolvedValue({ files: [], directories: [], parts: 1, duplicatePagesSkipped: 0 })
		importNotionExportMock.mockReturnValue({
			ir: {
				workspaceId: 'ws-1', source: 'notion',
				pages: [{
					title: 'Note', folderPath: null, properties: {}, tags: [],
					contentYjsBase64: Buffer.from('a').toString('base64'),
					plainText: 'a', isFolder: false, contentHash: 'hash',
				}],
			},
			report: {
				source: 'notion', pages: 1, folderPages: 0, linksResolved: 0, linksUnresolved: 0,
				degradedBlocks: 0, databaseViewsDeferred: 0, databaseRows: 0, syncedBlocksFlattened: 0,
				commentsOmitted: true, formulasRollupsFlattened: true, attachmentsDropped: 0,
				exportParts: 1, duplicatePagesSkipped: 0, degradations: [],
			},
		})
		global.fetch = vi.fn(async () => new Response(JSON.stringify({
			success: true, importedCount: 1, pages: [{ id: 'p-1', title: 'Note' }], warnings: [],
		}), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof global.fetch

		render(
			<ImportDialog
				open
				onOpenChange={() => {}}
				getWorkspace={async () => ({ id: 'ws-1' })}
				existingPageTitles={[]}
				onMarkdownFile={() => {}}
				onOpenPage={() => {}}
			/>
		)
		fireEvent.click(screen.getByText('Notion export (.zip)'))
		const input = screen.getByTestId('notion-zip-input') as HTMLInputElement
		const partOne = new File([new Uint8Array([1])], 'part-1.zip', { type: 'application/zip' })
		const partTwo = new File([new Uint8Array([2])], 'part-2.zip', { type: 'application/zip' })

		// Emulate the browser: resetting `value` empties the SAME FileList object.
		const liveFiles = [partOne, partTwo] as unknown as FileList & File[]
		Object.defineProperty(input, 'files', { configurable: true, get: () => liveFiles })
		Object.defineProperty(input, 'value', {
			configurable: true,
			get: () => '',
			set: () => { liveFiles.length = 0 },
		})

		fireEvent.change(input)

		await waitFor(() => expect(readNotionZipsMock).toHaveBeenCalled())
		expect(readNotionZipsMock.mock.calls[0][0]).toEqual([partOne, partTwo])
	})

	it('surfaces a Notion parse failure with an actionable error', async () => {
		readNotionZipsMock.mockRejectedValue(new Error(
			'No Notion pages or database rows found in that export. If you exported HTML, re-export with Export → Markdown & CSV.'
		))
		const fetchMock = vi.fn()
		global.fetch = fetchMock as unknown as typeof global.fetch

		render(
			<ImportDialog
				open
				onOpenChange={() => {}}
				getWorkspace={async () => ({ id: 'ws-1' })}
				existingPageTitles={[]}
				onMarkdownFile={() => {}}
				onOpenPage={() => {}}
			/>
		)
		fireEvent.click(screen.getByText('Notion export (.zip)'))
		const input = screen.getByTestId('notion-zip-input') as HTMLInputElement
		fireEvent.change(input, {
			target: { files: [new File([new Uint8Array([1])], 'export.zip', { type: 'application/zip' })] },
		})

		expect(await screen.findByTestId('import-error')).toBeTruthy()
		expect(screen.getByText(/Markdown & CSV/i)).toBeTruthy()
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('reuses the same clientImportId when retrying a failed Notion import (#87)', async () => {
		readNotionZipsMock.mockResolvedValue({ files: [], directories: [], parts: 1, duplicatePagesSkipped: 0 })
		importNotionExportMock.mockReturnValue({
			ir: {
				workspaceId: 'ws-1', source: 'notion',
				pages: [{
					title: 'Notion Note', folderPath: null, properties: {}, tags: [],
					contentYjsBase64: Buffer.from('a').toString('base64'),
					plainText: 'a', isFolder: false, contentHash: 'hash',
				}],
			},
			report: {
				source: 'notion', pages: 1, folderPages: 0, linksResolved: 0, linksUnresolved: 0,
				degradedBlocks: 0, databaseViewsDeferred: 0, databaseRows: 0, syncedBlocksFlattened: 0,
				commentsOmitted: true, formulasRollupsFlattened: true, attachmentsDropped: 0,
				exportParts: 1, duplicatePagesSkipped: 0, degradations: [],
			},
		})

		let call = 0
		const fetchMock = vi.fn(async () => {
			call += 1
			if (call === 1) {
				return new Response(JSON.stringify({ error: 'batch exploded' }), {
					status: 500, headers: { 'Content-Type': 'application/json' },
				})
			}
			return new Response(JSON.stringify({
				success: true, resumed: true, importedCount: 1,
				pages: [{ id: 'p-1', title: 'Notion Note' }], warnings: [],
			}), { status: 200, headers: { 'Content-Type': 'application/json' } })
		})
		global.fetch = fetchMock as unknown as typeof global.fetch

		render(
			<ImportDialog
				open
				onOpenChange={() => {}}
				getWorkspace={async () => ({ id: 'ws-1' })}
				existingPageTitles={[]}
				onMarkdownFile={() => {}}
				onOpenPage={() => {}}
			/>
		)

		const pickNotion = async () => {
			fireEvent.click(screen.getByText('Notion export (.zip)'))
			fireEvent.change(screen.getByTestId('notion-zip-input'), {
				target: { files: [new File([new Uint8Array([1])], 'export.zip', { type: 'application/zip' })] },
			})
			await waitFor(() => expect(screen.queryByTestId('import-progress')).not.toBeTruthy())
		}

		await pickNotion()
		expect(await screen.findByTestId('import-error')).toBeTruthy()

		fireEvent.click(screen.getByText('Try again'))
		await pickNotion()

		expect(await screen.findByTestId('import-report')).toBeTruthy()
		const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
		const first = JSON.parse(String(calls[0][1].body))
		const second = JSON.parse(String(calls[1][1].body))
		expect(second.clientImportId).toBe(first.clientImportId)
	})
})
