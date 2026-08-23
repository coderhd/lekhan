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

vi.mock('@/services/obsidian-import', () => ({
	readVaultZip: readVaultZipMock,
	readVaultFiles: readVaultFilesMock,
	readVaultDirectory: vi.fn(),
	pickVaultDirectory: pickVaultDirectoryMock,
	importObsidianVault: importObsidianVaultMock,
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
			plainText: 'a', isFolder: false,
		},
		{
			title: 'Note B', folderPath: null, properties: {}, tags: [],
			contentYjsBase64: Buffer.from('b').toString('base64'),
			plainText: 'b', isFolder: false,
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
})
