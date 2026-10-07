import { fromImportReport } from '@/lib/fidelity-report'
import { FidelityReportCard } from '@/components/fidelity-report-card'

/** Import-side counters, as produced by `services/obsidian-import.ts`. */
interface ImportCounters {
	pages: number
	folderPages: number
	linksResolved: number
	linksUnresolved: number
	degradedBlocks: number
}

interface ImportReportCardProps {
	report: ImportCounters
	/** Server-side warnings (snapshot/index failures) keyed by page title. */
	serverWarnings: Array<{ title: string; stage: string; error: string }>
	createdPages: Array<{ id: string; title: string }>
	onOpenPage: (pageId: string) => void
}

/**
 * Import adapter over the shared `FidelityReportCard` (SIL-9 story 26). The
 * report shape is direction-agnostic now; import just fills the import
 * counters and reuses the same honesty surface as export.
 */
export function ImportReportCard ({ report, serverWarnings, createdPages, onOpenPage }: ImportReportCardProps) {
	const fidelity = fromImportReport(report, serverWarnings)
	return (
		<FidelityReportCard
			report={fidelity}
			serverWarnings={serverWarnings}
			createdPages={createdPages}
			onOpenPage={onOpenPage}
		/>
	)
}
