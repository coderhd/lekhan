import { useEffect } from 'react'
import type { ObsidianImportReport } from '@/services/obsidian-import'
import { track } from '@/lib/analytics'

interface ImportReportCardProps {
	report: ObsidianImportReport
	/** Server-side warnings (snapshot/index failures) keyed by page title. */
	serverWarnings: Array<{ title: string; stage: string; error: string }>
	createdPages: Array<{ id: string; title: string }>
	onOpenPage: (pageId: string) => void
}

/**
 * The honest import report: what landed, what resolved, what degraded.
 * Per #27's spec — no silent data loss, ever. Interop moments are first
 * impressions; this card is where skeptical switchers decide to trust us.
 */
export function ImportReportCard ({ report, serverWarnings, createdPages, onOpenPage }: ImportReportCardProps) {
	const unresolved = Math.max(0, report.linksUnresolved)
	const previewPages = createdPages.slice(0, 8)
	const hiddenPages = createdPages.length - previewPages.length

	useEffect(() => {
		track('import_report_viewed', {
			pages: report.pages,
			folder_pages: report.folderPages,
			links_resolved: report.linksResolved,
			links_unresolved: report.linksUnresolved,
			degraded_blocks: report.degradedBlocks,
			warnings_count: serverWarnings.length,
		})
	}, [report, serverWarnings.length])

	return (
		<div className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-surface-container p-md text-sm" data-testid="import-report">
			<div className="flex items-center gap-sm mb-sm">
				<span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
				<p className="font-bold">Import complete</p>
			</div>

			<ul className="space-y-1 mb-md text-on-surface-variant">
				<li data-testid="report-pages">{report.pages} page{report.pages === 1 ? '' : 's'} created</li>
				{report.folderPages > 0 && <li>{report.folderPages} folder page{report.folderPages === 1 ? '' : 's'} created for your vault structure</li>}
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
			</ul>

			{serverWarnings.length > 0 && (
				<div className="rounded border border-amber-500/40 bg-amber-500/10 p-sm mb-md" data-testid="report-warnings">
					<p className="font-semibold mb-1">{serverWarnings.length} page{serverWarnings.length === 1 ? '' : 's'} need attention:</p>
					<ul className="list-disc list-inside text-on-surface-variant">
						{serverWarnings.map((warning, i) => (
							<li key={i}>
								<span className="font-medium">{warning.title}</span> — {warning.stage === 'snapshot' ? 'content could not be saved' : 'search/links could not be indexed'}: {warning.error}
							</li>
						))}
					</ul>
				</div>
			)}

			{createdPages.length > 0 && (
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
		</div>
	)
}
