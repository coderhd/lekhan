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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`page content read timed out after ${ms}ms`)), ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}

function hasContent(doc: Y.Doc): boolean {
	return doc.getXmlFragment(FRAGMENT).length > 0
}

function toJson(doc: Y.Doc): JSONContent {
	return markdownEngine.yjsStateToJson(Y.encodeStateAsUpdate(doc))
}

/**
 * Read a Page from the client's `y-indexeddb` cache, if it has one. Returns
 * `null` when the cache is absent, empty, or unreadable within `timeoutMs`.
 */
async function readLocalCopy(pageId: string, timeoutMs: number): Promise<JSONContent | null> {
	if (typeof indexedDB === 'undefined') return null
	const { IndexeddbPersistence } = await import('y-indexeddb')
	const doc = new Y.Doc()
	const persistence = new IndexeddbPersistence(pageId, doc)
	try {
		await withTimeout(
			new Promise<void>((resolve) => persistence.once('synced', () => resolve())),
			timeoutMs,
		)
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
 * then tear it down. Returns `null` on timeout/empty so the caller can warn.
 */
async function readRemoteCopy(
	pageId: string,
	opts: { token: string; wsUrl: string; timeoutMs: number },
): Promise<JSONContent | null> {
	const { WebsocketProvider } = await import('y-websocket')
	const doc = new Y.Doc()
	const provider = new WebsocketProvider(opts.wsUrl, pageId, doc, {
		params: { token: opts.token, documentId: pageId },
		connect: true,
	})
	try {
		await withTimeout(
			new Promise<void>((resolve) => provider.once('sync', () => resolve())),
			opts.timeoutMs,
		)
		return hasContent(doc) ? toJson(doc) : null
	} catch {
		return null
	} finally {
		provider.destroy()
		doc.destroy()
	}
}

/**
 * Build the injected `loadDoc` the pure loader expects: local-first, gap-sync
 * only when the device has no cached copy (ADR 0006).
 */
export function createClientPageDocSource(options: ClientPageDocSourceOptions): LoadPageDoc {
	const wsUrl = options.wsUrl ?? process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8080'
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	return async (pageId: string) => {
		const local = await readLocalCopy(pageId, timeoutMs)
		if (local) return local
		return readRemoteCopy(pageId, { token: options.token, wsUrl, timeoutMs })
	}
}
