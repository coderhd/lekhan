/**
 * One honest fidelity report shape for both interop directions (SIL-9 S4,
 * story 26). Import and export each fill the direction-agnostic counters and
 * add direction-specific omissions/warnings; the UI renders one card
 * (`components/fidelity-report-card.tsx`) so the two directions cannot drift
 * apart in what they admit.
 *
 * Keep this module dependency-free: it is imported by the import report
 * adapter, the export builder, and the card.
 */

export type FidelityDirection = 'import' | 'export'

/** A class of content that was deliberately not carried across, with why. */
export interface FidelityOmission {
	/** Stable machine key, e.g. `database-views`, `non-image-attachments`. */
	kind: string
	/** How many items of this kind (may be a page/row count). */
	count: number
	/** Human sentence naming the loss and, where applicable, where it lives now. */
	detail: string
}

/** A per-page failure that did not abort the whole operation (best-effort stages). */
export interface FidelityWarning {
	title: string
	stage: string
	error: string
}

export interface FidelityReport {
	direction: FidelityDirection
	/** Notes transferred (imported pages created / exported `.md` notes written). */
	pages: number
	/** Folder/container pages created (import) or consumed (export, no note emitted). */
	folderPages: number
	/** Distinct wikilinks whose target exists in the resulting graph. */
	linksResolved: number
	/** Distinct wikilinks whose target does not exist — preserved, connectable later. */
	linksUnresolved: number
	/** Blocks that could not be converted exactly and were kept as text/links. */
	degradedBlocks: number
	omissions: FidelityOmission[]
	warnings: FidelityWarning[]
}

/** The import-side counters, as produced by `services/obsidian-import.ts`. */
export interface ImportReportCounters {
	pages: number
	folderPages: number
	linksResolved: number
	linksUnresolved: number
	degradedBlocks: number
}

/** Adapt an import result into the shared shape. */
export function fromImportReport(
	report: ImportReportCounters,
	warnings: FidelityWarning[] = [],
	omissions: FidelityOmission[] = [],
): FidelityReport {
	return {
		direction: 'import',
		pages: report.pages,
		folderPages: report.folderPages,
		linksResolved: report.linksResolved,
		linksUnresolved: report.linksUnresolved,
		degradedBlocks: report.degradedBlocks,
		omissions: [...omissions],
		warnings: [...warnings],
	}
}

/** The copy for the database-views omission, reused by import and export. */
export const DATABASE_VIEWS_OMISSION = {
	kind: 'database-views',
	detail: 'Database views are deferred to Lekhan databases (H2 #47) and are not recreated in the exported files.',
} as const
