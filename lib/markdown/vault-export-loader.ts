import type { JSONContent } from '@tiptap/core'
import type { FidelityWarning } from '@/lib/fidelity-report'
import type { VaultPage } from '@/lib/markdown/vault-export'

/**
 * Page-content loader for the whole-Workspace vault export (SIL-9 S4a).
 *
 * The pure vault builder (`lib/markdown/vault-export.ts`) needs each Page's
 * Tiptap `doc`, but bodies are not reachable in bulk (see ADR 0006). This module
 * owns the *orchestration* — which Pages to load, in what order, with how much
 * concurrency, and what to do when one fails — while the actual read (local
 * `y-indexeddb` copy, gap-sync over the collab server) is injected as
 * `loadDoc`. That keeps the loader pure and unit-testable, and keeps the
 * browser/network glue in `lib/markdown/vault-export-source.ts`.
 */

/** Resolve one Page's Tiptap doc, or `null` when it is not available. */
export type LoadPageDoc = (pageId: string) => Promise<JSONContent | null>

export interface LoadVaultPageDocsOptions {
	loadDoc: LoadPageDoc
	/** Max simultaneous reads. Defaults to 4 (ADR 0006: no connection stampede). */
	concurrency?: number
	/** Called once per non-folder Page as it resolves. */
	onProgress?: (progress: { done: number; total: number }) => void
}

export interface LoadedVaultPages {
	/** Input Pages in the same order, with `doc` filled where it could be read. */
	pages: VaultPage[]
	/** Per-Page content failures; the export still proceeds (title-only note). */
	warnings: FidelityWarning[]
}

const DEFAULT_CONCURRENCY = 4

/**
 * Build a `VaultPage` from workspace page metadata. Imported folder-pages carry
 * `properties.importFolder` and contribute a directory (no note), per the S4
 * rules; everything else emits a note.
 */
export function toVaultPage(
	input: { id: string; parentId: string | null; title: string; properties?: Record<string, unknown> },
	tags: string[] = [],
): VaultPage {
	const properties = input.properties ?? {}
	return {
		id: input.id,
		parentId: input.parentId,
		title: input.title,
		properties,
		tags: tags.filter((tag) => tag.trim() !== ''),
		isFolder: properties.importFolder === true,
	}
}

/**
 * Fill in `doc` for every non-folder Page using `options.loadDoc`, bounded to
 * `concurrency` simultaneous reads. A Page whose doc cannot be read keeps no
 * `doc` (the builder emits a frontmatter/title-only note) and contributes a
 * `content`-stage warning — the export never aborts on one bad Page.
 */
export async function loadVaultPageDocs(
	pages: VaultPage[],
	options: LoadVaultPageDocsOptions,
): Promise<LoadedVaultPages> {
	const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY))
	const targets = pages.filter((page) => !page.isFolder)
	const total = targets.length
	const docs = new Map<string, JSONContent>()
	const warnings: FidelityWarning[] = []
	let done = 0
	let cursor = 0

	const runWorker = async (): Promise<void> => {
		while (true) {
			const index = cursor
			cursor += 1
			if (index >= targets.length) return
			const page = targets[index]
			try {
				const doc = await options.loadDoc(page.id)
				if (doc) docs.set(page.id, doc)
				else warnings.push({ title: page.title, stage: 'content', error: 'page content was not available' })
			} catch (err) {
				warnings.push({
					title: page.title,
					stage: 'content',
					error: err instanceof Error ? err.message : String(err),
				})
			} finally {
				done += 1
				options.onProgress?.({ done, total })
			}
		}
	}

	const workerCount = Math.min(concurrency, Math.max(targets.length, 1))
	await Promise.all(Array.from({ length: workerCount }, runWorker))

	return {
		pages: pages.map((page) => (docs.has(page.id) ? { ...page, doc: docs.get(page.id) } : page)),
		warnings,
	}
}
