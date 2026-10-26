/**
 * Source-agnostic import IR.
 *
 * The import pipeline was born Obsidian-shaped (#26/#27). H1's Notion zip route
 * is the second producer of the same contract, so the IR is generalized here
 * instead of forking a second writer: producers normalize their native export
 * into `ImportIR`, and `services/vault-import.ts` → `POST /api/import` →
 * `sync_page_graph` stays the only write path.
 *
 * Provenance travels with each page (source kind, original path, Notion block
 * id, database-row origin). It is metadata for the report and future producers;
 * the server ignores fields it does not know, and #87's retry fingerprint stays
 * content-based so provenance cannot make two identical imports diverge.
 */

export type ImportSourceKind = 'obsidian' | 'notion'

/** Where a page came from in its native export. */
export interface ImportPageProvenance {
	source: ImportSourceKind
	/** Path inside the source archive, before any name cleaning. */
	sourcePath: string
	/** Notion page/block id (32 hex, no dashes) when the export encodes one. */
	blockId?: string
	/** Present when this page is a row of an exported Notion database. */
	database?: {
		/** Cleaned database title. */
		title: string
		/** Path of the CSV that carried this row. */
		csvPath: string
		/** Column whose value became the Page title. */
		titleColumn: string
	}
}

export interface ImportPage {
	title: string
	folderPath: string | null
	properties: Record<string, unknown>
	tags: string[]
	contentYjsBase64: string
	plainText: string
	isFolder: boolean
	/**
	 * Deterministic hash of the fitted ProseMirror doc (#87). Captures marks,
	 * structure and attributes so a retry fingerprint can tell a real edit from
	 * a re-encoding of the same content.
	 */
	contentHash?: string
	/** Native-export origin; built-in producers always set it. */
	provenance?: ImportPageProvenance
}

export interface ImportIR {
	workspaceId: string
	/** Producer dialect. The write pipeline is source-agnostic. */
	source: ImportSourceKind
	pages: ImportPage[]
}

/**
 * A named, user-visible degradation. Import reports must never let data
 * disappear silently; each entry becomes a line the report card renders.
 */
export type ImportDegradationKind =
	| 'database-views'
	| 'synced-blocks'
	| 'comments'
	| 'formulas-rollups'
	| 'attachments'
	| 'unsupported-blocks'
	| 'duplicate-pages'

export interface ImportDegradation {
	kind: ImportDegradationKind
	count: number
	message: string
}

export interface ImportReport {
	pages: number
	folderPages: number
	linksResolved: number
	linksUnresolved: number
	degradedBlocks: number
	/** Producer-specific honest-degradation lines (optional for #27 callers). */
	degradations?: ImportDegradation[]
}
