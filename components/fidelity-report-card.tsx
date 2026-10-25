import { useEffect } from 'react'
import type { FidelityReport, FidelityWarning } from '@/lib/fidelity-report'
import { track } from '@/lib/analytics'

interface FidelityReportCardProps {
	report: FidelityReport
	/** Per-page warnings: import server-side snapshot/index failures, or export content reads. */
	serverWarnings?: FidelityWarning[]
	/** Import-only: pages created, surfaced as quick-open chips. */
	createdPages?: Array<{ id: string; title: string }>
	onOpenPage?: (pageId: string) => void
}

/** Warning copy differs by direction: import warns about writes/indexing, export about reads. */
function warningReason(warning: FidelityWarning, isExport: boolean): string {
	if (isExport) return 'content could not be read'
	return warning.stage === 'snapshot' ? 'content could not be saved' : 'search/links could not be indexed'
}

/**
 * The honest interop report, shared by import and export (SIL-9 story 26).
 * Import and export are two directions of the same promise — no silent data
 * loss — so they share one shape and one card; only the wording and the
 * import-only quick-open chips differ. Interop moments are first impressions;
 * this card is where skeptical switchers decide to trust us.
 */
export function FidelityReportCard({
	report,
	serverWarnings = [],
	createdPages = [],
	onOpenPage,
}: FidelityReportCardProps) {
	const isExport = report.direction === 'export'
	const unresolved = Math.max(0, report.linksUnresolved)
	const previewPages = createdPages.slice(0, 8)
	const hiddenPages = createdPages.length - previewPages.length

	useEffect(() => {
		const event = isExport ? 'export_report_viewed' : 'import_report_viewed'
		track(event, {
			pages: report.pages,
			folder_pages: report.folderPages,
			links_resolved: report.linksResolved,
			links_unresolved: report.linksUnresolved,
			degraded_blocks: report.degradedBlocks,
			omissions: report.omissions.length,
			warnings_count: serverWarnings.length,
		})
	}, [report, serverWarnings.length, isExport])

	const containerTestId = isExport ? 'export-report' : 'import-report'
	const noun = isExport ? 'written to your vault' : 'created'
	const folderCopy = isExport
		? `${report.folderPages} folder${report.folderPages === 1 ? '' : 's'} mirrored from your workspace`
		: `${report.folderPages} folder page${report.folderPages === 1 ? '' : 's'} created for your vault structure`

	return (
		<div className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-surface-container p-md text-sm" data-testid={containerTestId}>
			<div className="flex items-center gap-sm mb-sm">
				<span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
				<p className="font-bold">{isExport ? 'Export complete' : 'Import complete'}</p>
			</div>

			<ul className="space-y-1 mb-md text-on-surface-variant">
				<li data-testid="report-pages">{report.pages} page{report.pages === 1 ? '' : 's'} {noun}</li>
				{report.folderPages > 0 && <li>{folderCopy}</li>}
				<li data-testid="report-links">{report.linksResolved} link{report.linksResolved === 1 ? '' : 's'} resolved</li>
				{unresolved > 0 && (
					<li data-testid="report-unresolved">
						{unresolved} link{unresolved === 1 ? '' : 's'} point to pages that don't exist yet — they're preserved and will connect automatically if you create those pages later
					</li>
				)}
				{report.degradedBlocks > 0 && (
					<li data-testid="report-degraded">
						{report.degradedBlocks} block{report.degradedBlocks === 1 ? '' : 's'} couldn't be converted exactly (e.g. non-image embeds) and were kept as links instead
					</li>
				)}
				{report.omissions.map((omission) => (
					<li key={omission.kind} data-testid={`report-omission-${omission.kind}`}>
						{omission.count > 0 ? `${omission.count} ` : ''}{omission.detail}
					</li>
				))}
			</ul>

			{serverWarnings.length > 0 && (
				<div className="rounded border border-amber-500/40 bg-amber-500/10 p-sm mb-md" data-testid="report-warnings">
					<p className="font-semibold mb-1">{serverWarnings.length} page{serverWarnings.length === 1 ? '' : 's'} need attention:</p>
					<ul className="list-disc list-inside text-on-surface-variant">
						{serverWarnings.map((warning, i) => (
							<li key={i}>
								<span className="font-medium">{warning.title}</span> — {warningReason(warning, isExport)}: {warning.error}
							</li>
						))}
					</ul>
				</div>
			)}

			{createdPages.length > 0 && onOpenPage && (
				<div>
					<p className="font-semibold mb-xs">Open your imported pages:</p>
					<div className="flex flex-wrap gap-xs">
						{previewPages.map(page => (
							<button
								key={page.id}
								onClick={() => onOpenPage(page.id)}
								className="px-sm py-1 rounded-full bg-surface-container-high hover:bg-primary/10 border border-black/10 dark:border-white/10 premium-transition"
							>
								{page.title}
							</button>
						))}
						{hiddenPages > 0 && (
							<span className="px-sm py-1 text-on-surface-variant">+{hiddenPages} more — find them in your dashboard</span>
						)}
					</div>
				</div>
			)}

			{isExport && (
				<p className="text-on-surface-variant text-xs mt-sm">
					Documents are compatible, not synced — your vault copy is independent of Lekhan.
				</p>
			)}
		</div>
	)
}
