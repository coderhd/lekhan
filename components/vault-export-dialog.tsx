'use client'

import { useRef, useState } from 'react'
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { track } from '@/lib/analytics'
import { FidelityReportCard } from '@/components/fidelity-report-card'
import type { FidelityExportReport, VaultPage } from '@/lib/markdown/vault-export'
import { buildVaultFiles } from '@/lib/markdown/vault-export'
import { loadVaultPageDocs, toVaultPage } from '@/lib/markdown/vault-export-loader'
import { createClientPageDocSource } from '@/lib/markdown/vault-export-source'
import { buildZipBlob } from '@/lib/zip-write'
import { downloadBlob } from '@/lib/export-utils'
import { fetchWorkspacePageTags } from '@/services/graph'
import type { FidelityWarning } from '@/lib/fidelity-report'
import type { Page } from '@/types'

type Phase = 'confirm' | 'exporting' | 'done' | 'error'

interface VaultExportDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** Workspace pages (owned) to export as an Obsidian vault. */
	pages: Page[]
}

/**
 * Whole-Workspace → Obsidian vault export (SIL-9 S4a). Reads each Page's doc
 * local-first (ADR 0006), zips the vault in the browser, downloads it, and
 * shows the honest `FidelityReport` — compatibility, never live sync.
 */
export function VaultExportDialog({ open, onOpenChange, pages }: VaultExportDialogProps) {
	const [phase, setPhase] = useState<Phase>('confirm')
	const [progress, setProgress] = useState({ done: 0, total: 0 })
	const [report, setReport] = useState<FidelityExportReport | null>(null)
	const [warnings, setWarnings] = useState<FidelityWarning[]>([])
	const [errorMessage, setErrorMessage] = useState('')

	// Monotonic id for the in-flight export. Closing/cancelling (or starting a
	// new run) bumps it so a late-resolving run cannot download or write state.
	const runIdRef = useRef(0)
	// Aborts the in-flight read so cancellation actually stops IndexedDB/WebSocket
	// work instead of letting it run to completion behind a closed dialog.
	const abortRef = useRef<AbortController | null>(null)
	// Folders occupy no content read; the progress bar counts notes only.
	const exportableCount = pages.filter((page) => page.properties?.importFolder !== true).length

	const reset = () => {
		setPhase('confirm')
		setProgress({ done: 0, total: 0 })
		setReport(null)
		setWarnings([])
		setErrorMessage('')
	}

	const handleOpenChange = (next: boolean) => {
		if (!next) {
			// Invalidate and abort any in-flight run so it cannot keep reading,
			// download behind the closed dialog, or leave a stale report for the
			// next open.
			runIdRef.current += 1
			abortRef.current?.abort()
			abortRef.current = null
			reset()
		}
		onOpenChange(next)
	}

	const runExport = async () => {
		if (pages.length === 0) {
			toast.error('There are no pages to export yet.')
			return
		}
		// Supersede any run still in flight before starting the next one.
		abortRef.current?.abort()
		const controller = new AbortController()
		abortRef.current = controller
		const runId = ++runIdRef.current
		setPhase('exporting')
		setProgress({ done: 0, total: exportableCount })
		track('export_vault_started', { pages: pages.length })
		try {
			const { data: { session } } = await supabase.auth.getSession()
			const token = session?.access_token
			if (!token) throw new Error('Your session expired — sign in again to export.')

			const tagsByPage = await fetchWorkspacePageTags(pages.map((page) => page.id))
			const vaultPages: VaultPage[] = pages.map((page) =>
				toVaultPage(
					{ id: page.id, parentId: page.parent_id, title: page.title, properties: page.properties },
					tagsByPage.get(page.id) ?? [],
				),
			)

			const source = createClientPageDocSource({ token })
			const { pages: loaded, warnings: loadWarnings } = await loadVaultPageDocs(vaultPages, {
				loadDoc: source,
				signal: controller.signal,
				onProgress: ({ done, total }) => {
					if (runId === runIdRef.current) setProgress({ done, total })
				},
			})

			// Abandoned (dialog closed/cancelled) — never download a surprise zip.
			if (runId !== runIdRef.current || controller.signal.aborted) return

			const { files, report: exportReport } = buildVaultFiles(loaded)
			downloadBlob(buildZipBlob(files), 'lekhan-vault.zip')

			setWarnings(loadWarnings)
			setReport(exportReport)
			setPhase('done')
			track('export_vault_completed', {
				pages: exportReport.pages,
				links_unresolved: exportReport.linksUnresolved,
				warnings: loadWarnings.length,
			})
		} catch (err) {
			if (runId !== runIdRef.current || controller.signal.aborted) return
			setErrorMessage(err instanceof Error ? err.message : 'Export failed — please try again.')
			setPhase('error')
			track('export_vault_failed', { reason: err instanceof Error ? err.message : 'unknown' })
		}
	}

	const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogContent
				data-testid="vault-export-dialog"
				// Escape must not silently abandon a run mid-read; the exporting
				// phase offers an explicit Cancel instead.
				onEscapeKeyDown={(event) => {
					if (phase === 'exporting') event.preventDefault()
				}}
			>
				{phase === 'confirm' && (
					<>
						<AlertDialogHeader>
							<AlertDialogTitle>Export to Obsidian vault</AlertDialogTitle>
							<AlertDialogDescription>
								Download all {pages.length} page{pages.length === 1 ? '' : 's'} as a vault-shaped
								zip — folders mirror your workspace, wikilinks resolve, and callouts,
								frontmatter and tags stay native. Your files are compatible with Obsidian, not
								synced to it.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							{/* AlertDialogCancel registers the ref Radix auto-focuses on open. */}
							<AlertDialogCancel className="px-lg py-2 rounded-lg bg-surface-container hover:bg-surface-container-high font-medium premium-transition">
								Cancel
							</AlertDialogCancel>
							{/* Not AlertDialogAction: that is a Dialog.Close and would
							    dismiss the dialog instead of starting the export. */}
							<button
								onClick={runExport}
								className="px-lg py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-primary/90 premium-transition"
							>
								Export vault
							</button>
						</AlertDialogFooter>
					</>
				)}

				{phase === 'exporting' && (
					<>
						<AlertDialogHeader>
							<AlertDialogTitle>Exporting your vault…</AlertDialogTitle>
							<AlertDialogDescription>
								Reading page content ({progress.done}/{progress.total}). Keep this tab open.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<div className="w-full h-2 rounded-full bg-surface-container overflow-hidden" role="progressbar" aria-label="Export progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
							<div className="h-full bg-primary premium-transition" style={{ width: `${pct}%` }} />
						</div>
						<AlertDialogFooter>
							<AlertDialogCancel className="px-lg py-2 rounded-lg bg-surface-container hover:bg-surface-container-high font-medium premium-transition">
								Cancel
							</AlertDialogCancel>
						</AlertDialogFooter>
					</>
				)}

				{phase === 'done' && report && (
					<>
						<AlertDialogHeader>
							<AlertDialogTitle>Your vault is ready</AlertDialogTitle>
							<AlertDialogDescription>
								The zip has been downloaded. Drop it into Obsidian (File → Open vault) to open it.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<FidelityReportCard report={report} serverWarnings={warnings} />
						<AlertDialogFooter>
							<button
								onClick={() => handleOpenChange(false)}
								className="px-lg py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-primary/90 premium-transition"
							>
								Done
							</button>
						</AlertDialogFooter>
					</>
				)}

				{phase === 'error' && (
					<>
						<AlertDialogHeader>
							<AlertDialogTitle>Export failed</AlertDialogTitle>
							<AlertDialogDescription>{errorMessage}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<button
								onClick={() => setPhase('confirm')}
								className="px-lg py-2 rounded-lg bg-surface-container hover:bg-surface-container-high font-medium premium-transition"
							>
								Try again
							</button>
							<button
								onClick={() => handleOpenChange(false)}
								className="px-lg py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-primary/90 premium-transition"
							>
								Close
							</button>
						</AlertDialogFooter>
					</>
				)}
			</AlertDialogContent>
		</AlertDialog>
	)
}
