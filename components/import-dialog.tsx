import * as React from 'react'
import { useState, useRef } from 'react'
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { supabase } from '@/lib/supabase'
import {
	readVaultZip,
	readVaultFiles,
	readVaultDirectory,
	pickVaultDirectory,
	importObsidianVault,
	type ObsidianImportIR,
	type ObsidianImportReport,
	type VaultContent,
} from '@/services/obsidian-import'
import { importVaultIR } from '@/services/vault-import'
import { ImportReportCard } from '@/components/import-report-card'

type Phase = 'choose' | 'picking' | 'ingesting' | 'writing' | 'done' | 'error'

interface ImportDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	getWorkspace: () => Promise<{ id: string }>
	existingPageTitles: string[]
	onMarkdownFile: (file: File) => void
	onOpenPage: (pageId: string) => void
	/** Called once the writer has finished successfully (all batches). */
	onImportComplete?: () => void
}

const MARKDOWN_RE = /\.(md|markdown)$/i

export function ImportDialog ({
	open,
	onOpenChange,
	getWorkspace,
	existingPageTitles,
	onMarkdownFile,
	onOpenPage,
	onImportComplete,
}: ImportDialogProps) {
	const [phase, setPhase] = useState<Phase>('choose')
	const [errorMessage, setErrorMessage] = useState('')
	const [report, setReport] = useState<ObsidianImportReport | null>(null)
	const [serverWarnings, setServerWarnings] = useState<Array<{ title: string; stage: string; error: string }>>([])
	const [createdPages, setCreatedPages] = useState<Array<{ id: string; title: string }>>([])
	const zipInputRef = useRef<HTMLInputElement>(null)
	const folderInputRef = useRef<HTMLInputElement>(null)
	const markdownInputRef = useRef<HTMLInputElement>(null)

	const reset = () => {
		setPhase('choose')
		setErrorMessage('')
		setReport(null)
		setServerWarnings([])
		setCreatedPages([])
	}

	const handleOpenChange = (next: boolean) => {
		if (!next) {
			reset()
		}
		onOpenChange(next)
	}

	const fail = (message: string) => {
		setErrorMessage(message)
		setPhase('error')
	}

	const countMarkdownNotes = (content: VaultContent) =>
		content.files.filter(file => MARKDOWN_RE.test(file.path)).length

	const runIngestionAndWrite = async (content: VaultContent, workspaceId: string) => {
		if (countMarkdownNotes(content) === 0) {
			fail('No markdown notes found in that vault. Make sure you picked the folder that contains your .md files (not a subfolder or an export wrapper).')
			return
		}
		if (content.files.length > 0) {
			setPhase('ingesting')
			// Yield a frame so the "Reading your vault…" state paints before the
			// synchronous parse blocks the main thread.
			await new Promise(resolve => setTimeout(resolve, 30))
		}

		let result: ReturnType<typeof importObsidianVault>
		try {
			result = importObsidianVault(content, { workspaceId, existingPageTitles })
		} catch (err) {
			fail(err instanceof Error ? err.message : String(err))
			return
		}

		if (result.ir.pages.length === 0) {
			fail('No markdown notes found in that vault.')
			return
		}

		setPhase('writing')
		try {
			const outcome = await importVaultIR(
				result.ir as ObsidianImportIR,
				async () => {
					const { data } = await supabase.auth.getSession()
					return data.session?.access_token ?? ''
				}
			)
			setReport(result.report)
			setServerWarnings(outcome.warnings)
			setCreatedPages(outcome.createdPages)
			setPhase('done')
			onImportComplete?.()
		} catch (err) {
			fail(err instanceof Error ? err.message : String(err))
		}
	}

	const handleZipFile = async (file: File | undefined) => {
		if (!file) return
		setPhase('picking')
		try {
			const workspace = await getWorkspace()
			setPhase('ingesting')
			const content = await readVaultZip(file)
			await runIngestionAndWrite(content, workspace.id)
		} catch (err) {
			fail(err instanceof Error ? `Could not read that vault ZIP: ${err.message}` : String(err))
		}
	}

	const startFolderPick = () => {
		// Both showDirectoryPicker() and the hidden fallback input's click
		// require transient user activation from THIS click event — awaiting
		// anything (e.g. the workspace lookup) before opening them consumes
		// that activation and the picker throws SecurityError. The workspace
		// lookup is therefore deferred until after a folder has been chosen.
		setPhase('picking')
		Promise.resolve(pickVaultDirectory())
			.then(async (handle) => {
				if (!handle) {
					// FSA API unavailable (Firefox/Safari): fall back to the
					// webkitdirectory input so the user still has a path forward.
					folderInputRef.current?.click()
					setPhase('choose')
					return
				}
				const workspace = await getWorkspace()
				setPhase('ingesting')
				const content = await readVaultDirectory(handle)
				await runIngestionAndWrite(content, workspace.id)
			})
			.catch((err) => {
				// User cancelled the native picker: return to the chooser quietly.
				if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
					setPhase('choose')
					return
				}
				fail(err instanceof Error ? `Could not read that vault: ${err.message}` : String(err))
			})
	}

	const handleFolderFiles = async (files: FileList | null) => {
		if (!files || files.length === 0) return
		setPhase('picking')
		try {
			const workspace = await getWorkspace()
			setPhase('ingesting')
			const content = await readVaultFiles(Array.from(files))
			await runIngestionAndWrite(content, workspace.id)
		} catch (err) {
			fail(err instanceof Error ? `Could not read that vault: ${err.message}` : String(err))
		}
	}

	const busy = phase === 'picking' || phase === 'ingesting' || phase === 'writing'

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogContent className="max-w-lg">
				<AlertDialogHeader>
					<AlertDialogTitle>Import</AlertDialogTitle>
					<AlertDialogDescription>
						Bring your existing notes into Lekhan. Nothing is deleted from the source.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{phase === 'choose' && (
					<div className="grid gap-sm py-sm">
						<button
							onClick={() => zipInputRef.current?.click()}
							className="flex items-start gap-sm p-md rounded-lg border border-black/10 dark:border-white/10 hover:bg-surface-container-high text-left premium-transition"
						>
							<span className="material-symbols-outlined mt-0.5">folder_zip</span>
							<span>
								<span className="block font-bold">Obsidian vault (.zip)</span>
								<span className="block text-on-surface-variant text-sm">A ZIP of your vault folder — links, tags and callouts are preserved.</span>
							</span>
						</button>
						<button
							onClick={startFolderPick}
							className="flex items-start gap-sm p-md rounded-lg border border-black/10 dark:border-white/10 hover:bg-surface-container-high text-left premium-transition"
						>
							<span className="material-symbols-outlined mt-0.5">folder_open</span>
							<span>
								<span className="block font-bold">Obsidian vault (folder)</span>
								<span className="block text-on-surface-variant text-sm">Pick your vault folder directly.</span>
							</span>
						</button>
						<div className="flex items-center gap-sm px-md">
							<div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
							<span className="text-xs text-on-surface-variant">or</span>
							<div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
						</div>
						<button
							onClick={() => markdownInputRef.current?.click()}
							className="flex items-start gap-sm p-md rounded-lg border border-black/10 dark:border-white/10 hover:bg-surface-container-high text-left premium-transition"
						>
							<span className="material-symbols-outlined mt-0.5">description</span>
							<span>
								<span className="block font-bold">Single Markdown file</span>
								<span className="block text-on-surface-variant text-sm">One .md file becomes one page.</span>
							</span>
						</button>
					</div>
				)}

				{busy && (
					<div className="py-lg flex flex-col items-center gap-sm" data-testid="import-progress">
						<div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
						<p className="text-on-surface-variant text-sm">
							{phase === 'picking' && 'Preparing…'}
							{phase === 'ingesting' && 'Reading your vault — parsing notes, links and attachments…'}
							{phase === 'writing' && 'Creating pages in your workspace…'}
						</p>
					</div>
				)}

				{phase === 'done' && report && (
					<ImportReportCard
						report={report}
						serverWarnings={serverWarnings}
						createdPages={createdPages}
						onOpenPage={(pageId) => {
							handleOpenChange(false)
							onOpenPage(pageId)
						}}
					/>
				)}

				{phase === 'error' && (
					<div className="py-sm" data-testid="import-error">
						<div className="rounded border border-red-500/40 bg-red-500/10 p-md mb-sm">
							<p className="font-semibold mb-1">Import failed</p>
							<p className="text-on-surface-variant text-sm">{errorMessage}</p>
						</div>
					</div>
				)}

				<AlertDialogFooter>
					{phase === 'error' && (
						<button onClick={reset} className="px-md py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-primary/90 premium-transition">
							Try again
						</button>
					)}
					{!busy && (
						<button onClick={() => handleOpenChange(false)} className="px-md py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 premium-transition">
							{phase === 'done' ? 'Close' : 'Cancel'}
						</button>
					)}
				</AlertDialogFooter>

				<input
					ref={zipInputRef}
					type="file"
					accept=".zip"
					className="hidden"
					onChange={(e) => {
						const file = e.target.files?.[0]
						e.target.value = ''
						void handleZipFile(file)
					}}
				/>
				<input
					ref={markdownInputRef}
					type="file"
					accept=".md,.markdown,.mdown,.txt"
					className="hidden"
					onChange={(e) => {
						const file = e.target.files?.[0]
						e.target.value = ''
						if (file) {
							handleOpenChange(false)
							onMarkdownFile(file)
						}
					}}
				/>
				{/* Fallback folder picker for browsers without the File System Access API */}
				<input
					ref={folderInputRef}
					type="file"
					multiple
					// @ts-expect-error non-standard but widely supported directory picker attribute
					webkitdirectory=""
					className="hidden"
					onChange={(e) => {
						const files = e.target.files
						e.target.value = ''
						void handleFolderFiles(files)
					}}
				/>
			</AlertDialogContent>
		</AlertDialog>
	)
}
