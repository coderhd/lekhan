import * as Y from 'yjs'
import type { JSONContent } from '@tiptap/core'
import { markdownEngine } from '@/lib/markdown/engine'
import type { LoadPageDoc } from '@/lib/markdown/vault-export-loader'

/**
 * Browser edge of the vault-export content loader (SIL-9 S4a, ADR 0006).
 *
 * The editor persists every opened Page in `y-indexeddb` under its `pageId`
 * and streams live content over the y-websocket collab server (ADR 0004). The
 * whole-Workspace export needs *every* Page's doc, so this module reads each
 * one local-first: a cached `y-indexeddb` copy when present, otherwise a
 * short-lived `WebsocketProvider` gap-sync. No server export endpoint.
 *
 * Kept separate from `vault-export-loader.ts` so the orchestration stays pure
 * and testable; this file is the only part that touches browser/network APIs.
 */

const DEFAULT_TIMEOUT_MS = 8000
/** The live editor's Tiptap Collaboration extension writes this fragment. */
const FRAGMENT = 'default'

export interface ClientPageDocSourceOptions {
	/** Supabase access token; the collab server authenticates the user with it. */
	token: string
	wsUrl?: string
	/** Per-Page budget for the local read and (if needed) the remote sync. */
	timeoutMs?: number
}

function abortError(): Error {
	return typeof DOMException !== 'undefined'
		? new DOMException('The operation was aborted.', 'AbortError')
		: new Error('The operation was aborted.')
}

/**
 * Resolve when `emitter` fires `event`, or reject on timeout / abort. The
 * timer is always cleared and the abort listener always detached, so a
 * timed-out or cancelled read leaves nothing attached.
 */
function waitForEvent(
	emitter: { once(event: string, listener: () => void): void },
	event: string,
	ms: number,
	signal?: AbortSignal,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let settled = false
		const onAbort = () => finish(abortError())
		const timer = setTimeout(() => finish(new Error(`page content read timed out after ${ms}ms`)), ms)
		const finish = (error?: Error) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			signal?.removeEventListener('abort', onAbort)
			if (error) reject(error)
			else resolve()
		}
		if (signal?.aborted) {
			finish(abortError())
			return
		}
		signal?.addEventListener('abort', onAbort)
		emitter.once(event, () => finish())
	})
}

function hasContent(doc: Y.Doc): boolean {
	return doc.getXmlFragment(FRAGMENT).length > 0
}

function toJson(doc: Y.Doc): JSONContent {
	return markdownEngine.yjsStateToJson(Y.encodeStateAsUpdate(doc))
}

/**
 * Whether this device already has an `y-indexeddb` database for the Page,
 * without leaving an empty one behind. Constructing `IndexeddbPersistence` for
 * a Page that was never opened would create and persist an empty database as a
 * side effect (y-indexeddb writes an auto-key update on load), so a bulk export
 * must not do that for thousands of Pages.
 *
 * The only safe check is `indexedDB.databases()` (Chrome/Edge/Safari, Firefox
 * 126+). Where that is unavailable — Firefox 111–125 is inside Next.js's default
 * browser range — we report "absent" instead of probing by opening the database.
 * An open-then-delete probe cannot be made race-free: between our
 * `result.close()` and `deleteDatabase(pageId)`, another tab can open the same
 * database, after which the pending delete either wipes a cache that session
 * just populated (once it closes) or fires `versionchange` into its live editor
 * and halts persistence. Reporting "absent" only costs export speed on legacy
 * browsers — `createClientPageDocSource` gap-syncs every Page from the collab
 * server — so correctness is unchanged without ever deleting a database we did
 * not exclusively create-and-close with zero intervening connections.
 */
export async function hasLocalDatabase(
	pageId: string,
	factory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined,
): Promise<boolean> {
	if (!factory) return false
	if (typeof factory.databases !== 'function') return false
	try {
		const databases = await factory.databases()
		return databases.some((entry) => entry.name === pageId)
	} catch {
		// Enumeration unavailable/failed; fall back to the remote sync path.
		return false
	}
}

/**
 * Read a Page from the client's `y-indexeddb` cache, if it has one. Returns
 * `null` when the cache is absent, empty, unreadable, or the read is aborted.
 */
async function readLocalCopy(pageId: string, timeoutMs: number, signal?: AbortSignal): Promise<JSONContent | null> {
	if (typeof indexedDB === 'undefined' || signal?.aborted) return null
	if (!(await hasLocalDatabase(pageId))) return null
	if (signal?.aborted) return null
	const { IndexeddbPersistence } = await import('y-indexeddb')
	const doc = new Y.Doc()
	const persistence = new IndexeddbPersistence(pageId, doc)
	try {
		await waitForEvent(persistence, 'synced', timeoutMs, signal)
		return hasContent(doc) ? toJson(doc) : null
	} catch {
		return null
	} finally {
		persistence.destroy()
		doc.destroy()
	}
}

/**
 * Gap-sync a single Page from the collab server with a short-lived provider,
 * then tear it down. Returns `null` only on timeout/error/abort — a successful
 * sync of an empty room returns the Page's (empty) doc, so a never-edited Page
 * is exported as a title-only note without a false "content could not be read"
 * warning (`loadVaultPageDocs` warns only on `null`).
 */
async function readRemoteCopy(
	pageId: string,
	opts: { token: string; wsUrl: string; timeoutMs: number },
	signal?: AbortSignal,
): Promise<JSONContent | null> {
	if (signal?.aborted) return null
	const { WebsocketProvider } = await import('y-websocket')
	const doc = new Y.Doc()
	const provider = new WebsocketProvider(opts.wsUrl, pageId, doc, {
		params: { token: opts.token, documentId: pageId },
		connect: true,
	})
	try {
		await waitForEvent(provider, 'sync', opts.timeoutMs, signal)
		return toJson(doc)
	} catch {
		return null
	} finally {
		provider.destroy()
		doc.destroy()
	}
}

/**
 * Build the injected `loadDoc` the pure loader expects: local-first, gap-sync
 * only when the device has no cached copy (ADR 0006). An optional `AbortSignal`
 * cancels an in-flight read and closes its persistence/provider promptly.
 */
export function createClientPageDocSource(options: ClientPageDocSourceOptions): LoadPageDoc {
	const wsUrl = options.wsUrl ?? process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8080'
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	return async (pageId: string, signal?: AbortSignal) => {
		if (signal?.aborted) return null
		const local = await readLocalCopy(pageId, timeoutMs, signal)
		if (signal?.aborted) return null
		if (local) return local
		return readRemoteCopy(pageId, { token: options.token, wsUrl, timeoutMs }, signal)
	}
}
