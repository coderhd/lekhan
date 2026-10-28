import { useMemo } from 'react'
import { fromImportReport } from '@/lib/fidelity-report'
import { FidelityReportCard } from '@/components/fidelity-report-card'
import type { ImportReport } from '@/services/import-ir'

interface ImportReportCardProps {
	report: ImportReport
	/** Server-side warnings (snapshot/index failures) keyed by page title. */
	serverWarnings: Array<{ title: string; stage: string; error: string }>
	createdPages: Array<{ id: string; title: string }>
	/** Pages recovered from an already-landed batch when resuming (#87). */
	resumedCount?: number
	onOpenPage: (pageId: string) => void
}

/**
 * Import adapter over the shared `FidelityReportCard` (SIL-9 story 26).
 *
 * Import and export are two directions of one honesty promise, so they share a
 * single shape and card. Import contributes its producer-specific degradation
 * lines (Notion database views, synced blocks, comments, formulas/rollups,
 * dropped attachments) as report omissions — nothing disappears silently.
 */
export function ImportReportCard ({
	report,
	serverWarnings,
	createdPages,
	resumedCount = 0,
	onOpenPage,
}: ImportReportCardProps) {
	// Stable identity: `FidelityReportCard` fires `import_report_viewed` from an
	// effect keyed on `report`, so a fresh object per render would re-fire the
	// event on every parent re-render.
	const fidelity = useMemo(() => fromImportReport(report, serverWarnings), [report, serverWarnings])
	return (
		<FidelityReportCard
			report={fidelity}
			serverWarnings={serverWarnings}
			createdPages={createdPages}
			resumedCount={resumedCount}
			onOpenPage={onOpenPage}
		/>
	)
}
