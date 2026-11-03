const Y = require('yjs')
const { getYDoc, docs } = require('y-websocket/bin/utils')

/**
 * Hydration-gated persistence for the y-websocket hub (SIL-214).
 *
 * y-websocket calls `persistence.bindState()` **without awaiting** and sends
 * sync step 1 to the client immediately. For a cold room that means the client
 * syncs an empty document while the stored snapshot is still downloading, and
 * the last close then calls `writeState()` with that empty doc — truncating the
 * real `documents/<pageId>/main_state.bin` snapshot.
 *
 * Two guarantees live here:
 *
 * 1. `bindState` records hydration state on the doc. `writeState` refuses to
 *    persist a doc that is not fully hydrated, so a slow/failed read can never
 *    overwrite the stored snapshot.
 * 2. `openHydratedDoc` is awaited by the WebSocket upgrade path before
 *    `setupWSConnection` runs, so the room does not answer a sync request until
 *    the snapshot has been applied.
 *
 * Read-only rooms (export gap-syncs) are additionally protected by
 * `markWritable`: a room that only ever had read-only connections is never
 * persisted on close.
 */

const DEFAULT_HYDRATION_TIMEOUT_MS = 15000

/**
 * @typedef {'pending' | 'hydrated' | 'failed'} HydrationStatus
 * @typedef {{ status: HydrationStatus, error?: unknown }} HydrationState
 */

/**
 * @param {object} options
 * @param {(documentId: string) => Promise<Uint8Array | null>} options.loadState
 *   Download + decrypt the stored Yjs update. Resolve `null` when the document
 *   has no stored snapshot yet (a new Page).
 * @param {(documentId: string, ydoc: import('yjs').Doc) => Promise<unknown>} options.persistState
 * @param {(documentId: string, ydoc: import('yjs').Doc) => void} [options.scheduleSave]
 * @param {(documentId: string) => void} [options.clearSave]
 * @param {Pick<Console, 'log' | 'warn' | 'error'>} [options.logger]
 */
function createCollabPersistence({
	loadState,
	persistState,
	scheduleSave = () => {},
	clearSave = () => {},
	logger = console,
}) {
	async function hydrate(documentId, ydoc) {
		/** @type {HydrationState} */
		const hydration = { status: 'pending' }
		ydoc.__hydration = hydration
		// A freshly created room starts read-only. The upgrade path promotes it
		// when a writable connection is admitted.
		ydoc.__everWritable = false

		try {
			logger.log(`[Persist] Loading document ${documentId}...`)
			const state = await loadState(documentId)
			if (state) {
				Y.applyUpdate(ydoc, state, 'supabase-load')
			}
			hydration.status = 'hydrated'
			logger.log(`[Persist] Document ${documentId} fully loaded.`)
		} catch (err) {
			// Never persist a doc we could not hydrate: an empty in-memory doc
			// would overwrite a snapshot that may hold the user's only copy.
			hydration.status = 'failed'
			hydration.error = err
			logger.error(
				`[Persist Error] Failed to hydrate ${documentId}; writes disabled to protect the stored snapshot:`,
				err,
			)
		}

		// A failed room has no trustworthy base; it is rejected by
		// `openHydratedDoc`, so never wire a save listener that could later
		// write it back.
		if (hydration.status !== 'hydrated') return

		// Attach the debounced-save listener after hydration so the load itself
		// never schedules a save. The status guard keeps any future server-side
		// `Y.applyUpdate` (import seeding, version restore) from bypassing the
		// hydration gate.
		ydoc.on('update', (update, origin) => {
			if (origin === 'supabase-load') {
				return
			}
			if (ydoc.__hydration?.status !== 'hydrated') return
			scheduleSave(documentId, ydoc)
		})
	}

	return {
		bindState: (documentId, ydoc) => {
			const promise = hydrate(documentId, ydoc)
			// Read synchronously by `openHydratedDoc` immediately after getYDoc().
			ydoc.__hydrationPromise = promise
			return promise
		},
		writeState: async (documentId, ydoc) => {
			clearSave(documentId)

			const hydration = ydoc.__hydration
			if (!hydration || hydration.status !== 'hydrated') {
				logger.warn(
					`[Persist] Refusing to save ${documentId}: hydration is ${hydration?.status ?? 'not started'}. Stored snapshot left untouched.`,
				)
				return { ok: false, skipped: true, reason: 'not-hydrated' }
			}
			if (ydoc.__everWritable !== true) {
				// Only read-only (export) connections ever owned this room, so
				// there is nothing to save and no reason to touch storage.
				return { ok: false, skipped: true, reason: 'read-only' }
			}

			try {
				await persistState(documentId, ydoc)
				return { ok: true }
			} catch (err) {
				// Let y-websocket destroy the room; do not leave an unhandled
				// rejection behind. The result lets the shutdown flush report
				// how many saves actually failed.
				logger.error(`[Persist Error] Failed to save ${documentId}:`, err)
				return { ok: false, error: err }
			}
		},
	}
}

/**
 * Mark a room as writable. Called once per admitted non-read-only connection,
 * before the connection is handed to y-websocket.
 *
 * @param {import('yjs').Doc & { __everWritable?: boolean }} ydoc
 */
function markWritable(ydoc) {
	ydoc.__everWritable = true
}

/**
 * Get (or create) the room for `documentId` and resolve once `bindState` has
 * finished applying the stored snapshot. The upgrade path awaits this before
 * `setupWSConnection`, which prevents the pre-hydration empty sync.
 *
 * @param {string} documentId
 * @param {{ timeoutMs?: number, logger?: Pick<Console, 'error'> }} [options]
 */
async function openHydratedDoc(documentId, { timeoutMs = DEFAULT_HYDRATION_TIMEOUT_MS, logger = console } = {}) {
	const doc = getYDoc(documentId)
	doc.__pendingConnections = (doc.__pendingConnections || 0) + 1

	try {
		const promise = doc.__hydrationPromise
		if (!promise) return doc

		let timer
		const timeout = new Promise((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`document hydration timed out after ${timeoutMs}ms`)),
				timeoutMs,
			)
		})
		try {
			await Promise.race([promise, timeout])
		} finally {
			clearTimeout(timer)
		}

		// Do not hand a client an empty room we could not hydrate: a normal
		// editor would look like a blank Page and silently lose writes, and a
		// vault export would read an empty body. Drop the room so the caller's
		// retry re-attempts the download instead of reusing a settled failure.
		if (doc.__hydration?.status === 'failed') {
			docs.delete(documentId)
			doc.destroy()
			throw new Error(`document ${documentId} could not be hydrated from its stored snapshot`)
		}
		return doc
	} catch (err) {
		logger.error(`[Persist Error] Hydration gate failed for ${documentId}:`, err)
		throw err
	} finally {
		doc.__pendingConnections = Math.max(0, (doc.__pendingConnections || 1) - 1)
	}
}

module.exports = {
	DEFAULT_HYDRATION_TIMEOUT_MS,
	createCollabPersistence,
	markWritable,
	openHydratedDoc,
}
