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

/**
 * How a Page's content read ended.
 *
 * - `ok` — a non-empty body was read.
 * - `empty` — the read completed but produced no blocks. This is only a
 *   genuine empty Page when the Page has no evidence of content; otherwise it
 *   is *unknown* (a failed/early hydration) and the loader warns (SIL-214 B1).
 * - `unavailable` — no read completed (timeout, aborted, network/provider
 *   error), distinct from a completed empty read.
 */
export type PageDocReadStatus = 'ok' | 'empty' | 'unavailable'

export interface PageDocReadResult {
	doc: JSONContent | null
	status: PageDocReadStatus
}

/** Resolve one Page's Tiptap doc plus whether the read can be trusted. */
export type LoadPageDoc = (pageId: string, signal?: AbortSignal) => Promise<PageDocReadResult>

export interface LoadVaultPageDocsOptions {
	loadDoc: LoadPageDoc
	/** Max simultaneous reads. Defaults to 4 (ADR 0006: no connection stampede). */
	concurrency?: number
	/** Called once per non-folder Page as it resolves. */
	onProgress?: (progress: { done: number; total: number }) => void
	/**
	 * Cooperative cancellation. When aborted, workers stop scheduling new Pages,
	 * `loadDoc` is expected to reject/return early, and no further progress or
	 * warnings are recorded. The returned Pages still echo the input shape.
	 */
	signal?: AbortSignal
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
	input: {
		id: string
		parentId: string | null
		title: string
		properties?: Record<string, unknown>
		/** `pages.searchable_text`: evidence that the Page has a body. */
		searchableText?: string | null
	},
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
		hasStoredContent: typeof input.searchableText === 'string' && input.searchableText.trim() !== '',
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
		while (!options.signal?.aborted) {
			const index = cursor
			cursor += 1
			if (index >= targets.length) return
			const page = targets[index]
			try {
				const result = await options.loadDoc(page.id, options.signal)
				// A read that resolved after cancellation must not be reported.
				if (options.signal?.aborted) return
				if (result.status === 'ok' && result.doc) {
					docs.set(page.id, result.doc)
				} else if (result.status === 'empty') {
					// A completed read with no blocks is only trustworthy when the
					// Page has no evidence of content. Otherwise the content is
					// unknown: name it instead of reporting a clean export (SIL-214 B1).
					if (page.hasStoredContent) {
						warnings.push({
							title: page.title,
							stage: 'content-unverified',
							error: 'the stored page has content, but the exported body was empty',
						})
					}
				} else {
					warnings.push({ title: page.title, stage: 'content', error: 'page content was not available' })
				}
			} catch (err) {
				// A read stopped by cancellation is not a Page failure.
				if (options.signal?.aborted) return
				warnings.push({
					title: page.title,
					stage: 'content',
					error: err instanceof Error ? err.message : String(err),
				})
			} finally {
				if (!options.signal?.aborted) {
					done += 1
					options.onProgress?.({ done, total })
				}
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
