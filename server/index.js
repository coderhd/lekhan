const http = require('http')
const WebSocket = require('ws')
const Y = require('yjs')
const { setupWSConnection, docs } = require('y-websocket/bin/utils')
const { createClient } = require('@supabase/supabase-js')
const { getSupabaseClient, verifyUserRole, getDocumentOwnerPlan } = require('./auth')
const { getPlanLimits } = require('../lib/tier-limits.ts')
const { pruneExpiredDocumentVersions } = require('./retention.js')
const { admitCollaborator } = require('./ledger.js')
const graphIndex = require('./graph-index')
const { encryptSnapshot, decryptSnapshot } = require('./crypto')

const port = process.env.PORT || 8080
const MAX_CONNECTIONS = 1500
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024 // 10 MB payload guard

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'

// Initialize privileged Supabase client for backend operations
const supabaseAdmin = createClient(
	supabaseUrl,
	supabaseKey,
	{
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	}
)

const wss = new WebSocket.Server({
	noServer: true,
	maxPayload: MAX_PAYLOAD_BYTES,
})

// Cache save timers
const saveDebounceTimers = new Map()
const saveMaxThrottleTimers = new Map()

function clearSaveTimers (documentId) {
	if (saveDebounceTimers.has(documentId)) {
		clearTimeout(saveDebounceTimers.get(documentId))
		saveDebounceTimers.delete(documentId)
	}
	if (saveMaxThrottleTimers.has(documentId)) {
		clearTimeout(saveMaxThrottleTimers.get(documentId))
		saveMaxThrottleTimers.delete(documentId)
	}
}

// In-flight save serialization per document to avoid concurrent writes to main_state.bin
const inFlightSaves = new Map()
const queuedFollowUpSaves = new Map()

function triggerSerializedSave (documentId, ydoc) {
	if (inFlightSaves.has(documentId)) {
		queuedFollowUpSaves.set(documentId, ydoc)
		return inFlightSaves.get(documentId)
	}

	const savePromise = (async () => {
		try {
			await saveDocumentState(documentId, ydoc)
		} finally {
			inFlightSaves.delete(documentId)
			if (queuedFollowUpSaves.has(documentId)) {
				const nextYdoc = queuedFollowUpSaves.get(documentId)
				queuedFollowUpSaves.delete(documentId)
				// Defer follow-up save asynchronously
				triggerSerializedSave(documentId, nextYdoc).catch((err) => {
					console.error(`[Sync] Follow-up save error for ${documentId}:`, err)
				})
			}
		}
	})()

	inFlightSaves.set(documentId, savePromise)
	return savePromise
}

// Track pending asynchronous WebSocket upgrade reservations
let pendingUpgrades = 0

// Health and metrics helper
function getServerMetrics () {
	const mem = process.memoryUsage()
	const heapTotal = mem.heapTotal || 1
	const heapUsed = mem.heapUsed || 0
	const heapUtilizationPct = Math.round((heapUsed / heapTotal) * 100)
	const isMemoryExhausted = mem.heapTotal > 0 && (heapUsed / heapTotal) > 0.85
	const totalConnections = wss.clients.size + pendingUpgrades
	const isShedding = totalConnections >= MAX_CONNECTIONS || isMemoryExhausted

	return {
		status: isShedding ? 'shedding' : 'ok',
		uptimeSeconds: Math.floor(process.uptime()),
		activeDocuments: docs.size,
		activeConnections: wss.clients.size,
		pendingUpgrades,
		memory: {
			rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
			heapUsedMb: Math.round((heapUsed / (1024 * 1024)) * 10) / 10,
			heapTotalMb: Math.round((heapTotal / (1024 * 1024)) * 10) / 10,
		},
		limits: {
			maxConnections: MAX_CONNECTIONS,
			heapUtilizationPct,
			isShedding,
		},
	}
}

const server = http.createServer((req, res) => {
	if (req.url === '/health' || req.url === '/metrics') {
		const metrics = getServerMetrics()
		const statusCode = metrics.status === 'shedding' ? 503 : 200
		res.writeHead(statusCode, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify(metrics, null, 2))
		return
	}

	res.writeHead(200, { 'Content-Type': 'text/plain' })
	res.end('WebSocket Sync Server Running\n')
})

// Helper to save document state to Supabase Storage and update text index
async function saveDocumentState (documentId, ydoc) {
	try {
		console.log(`[Sync] Saving document ${documentId} to Supabase...`)

		// 1. Encode Yjs state to binary and encrypt at rest (ADR 0001)
		const stateUpdate = Y.encodeStateAsUpdate(ydoc)
		const encryptedBuffer = encryptSnapshot(stateUpdate)

		// 2. Upload encrypted binary to Supabase Storage documents bucket
		const { error: uploadError } = await supabaseAdmin.storage
			.from('documents')
			.upload(`${documentId}/main_state.bin`, encryptedBuffer, {
				contentType: 'application/octet-stream',
				upsert: true,
			})

		if (uploadError) {
			throw uploadError
		}

		// 3. Extract text content; update pages first, fall back to legacy documents
		const textContent = ydoc.getText('default').toString()
		const { data: pageRow } = await supabaseAdmin
			.from('pages')
			.select('id')
			.eq('id', documentId)
			.maybeSingle()

		if (pageRow) {
			await graphIndex.indexPage(supabaseAdmin, documentId, textContent)
		} else {
			const { error: dbError } = await supabaseAdmin
				.from('documents')
				.update({
					searchable_text: textContent,
					updated_at: new Date().toISOString(),
				})
				.eq('id', documentId)

			if (dbError) {
				throw dbError
			}
		}

		console.log(`[Sync] Document ${documentId} successfully synced to Supabase.`)

		// 4. Prune expired versions
		try {
			const ownerPlan = await getDocumentOwnerPlan(supabaseAdmin, documentId)
			if (ownerPlan) {
				const { prunedCount } = await pruneExpiredDocumentVersions(supabaseAdmin, documentId, ownerPlan, new Date())
				if (prunedCount > 0) {
					console.log(`[Retention] Pruned ${prunedCount} expired versions for doc ${documentId}`)
				}
			}
		} catch (planError) {
			console.warn(`[Retention] Skipping retention pruning for doc ${documentId} due to plan resolution failure:`, planError)
		}

	} catch (error) {
		console.error(`[Sync Error] Failed to save document ${documentId}:`, error)
		throw error
	}
}

// Hook into Yjs document initialization
const { setPersistence } = require('y-websocket/bin/utils')

function scheduleDebouncedSave (documentId, ydoc) {
	// Clear previous idle debounce timer
	if (saveDebounceTimers.has(documentId)) {
		clearTimeout(saveDebounceTimers.get(documentId))
	}

	// Schedule hard 10-second max-throttle if not already running
	if (!saveMaxThrottleTimers.has(documentId)) {
		const maxThrottleTimer = setTimeout(async () => {
			clearSaveTimers(documentId)
			await triggerSerializedSave(documentId, ydoc).catch((err) => {
				console.error(`[Sync Error] Max throttle save failed for ${documentId}:`, err)
			})
		}, 10000)
		saveMaxThrottleTimers.set(documentId, maxThrottleTimer)
	}

	// Set 2-second idle debounce save
	const debounceTimer = setTimeout(async () => {
		clearSaveTimers(documentId)
		await triggerSerializedSave(documentId, ydoc).catch((err) => {
			console.error(`[Sync Error] Idle debounce save failed for ${documentId}:`, err)
		})
	}, 2000)

	saveDebounceTimers.set(documentId, debounceTimer)
}

setPersistence({
	bindState: async (documentId, ydoc) => {
		try {
			console.log(`[Persist] Loading document ${documentId}...`)

			// 1. Fetch base Yjs state from Supabase Storage and decrypt at rest (ADR 0001)
			const { data, error } = await supabaseAdmin.storage
				.from('documents')
				.download(`${documentId}/main_state.bin`)

			if (data) {
				const arrayBuffer = await data.arrayBuffer()
				const decrypted = decryptSnapshot(Buffer.from(arrayBuffer))
				const uint8Array = new Uint8Array(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength)
				Y.applyUpdate(ydoc, uint8Array, 'supabase-load')
				console.log(`[Persist] Base state applied for ${documentId}`)
			} else if (error && error.status !== 404) {
				// Log errors other than file not found (new document)
				console.error(`[Persist Error] Download failed for ${documentId}:`, error)
			}

			console.log(`[Persist] Document ${documentId} fully loaded.`)
		} catch (err) {
			console.error(`[Persist Error] Failed to bind state for ${documentId}:`, err)
		}

		// 2. Attach change listener to trigger capped debounced serialized saves
		ydoc.on('update', (update, origin) => {
			// Skip saving if the update originated from the server loading base state
			if (origin === 'supabase-load') {
				return
			}
			scheduleDebouncedSave(documentId, ydoc)
		})
	},
	writeState: async (documentId, ydoc) => {
		clearSaveTimers(documentId)
		await triggerSerializedSave(documentId, ydoc)
	},
})

server.on('upgrade', async (request, socket, head) => {
	// Synchronous pending-upgrade reservation
	pendingUpgrades++
	let reservationReleased = false
	const releaseUpgradeReservation = () => {
		if (!reservationReleased) {
			reservationReleased = true
			pendingUpgrades = Math.max(0, pendingUpgrades - 1)
		}
	}

	socket.once('close', releaseUpgradeReservation)
	socket.once('error', releaseUpgradeReservation)

	// 1. Concurrency & Load-Shedding Protection
	const mem = process.memoryUsage()
	const isMemoryExhausted = mem.heapTotal > 0 && (mem.heapUsed / mem.heapTotal) > 0.85
	const totalLoad = wss.clients.size + pendingUpgrades

	if (totalLoad > MAX_CONNECTIONS || isMemoryExhausted) {
		console.warn(`[LoadShedding] Connection rejected: totalLoad=${totalLoad}/${MAX_CONNECTIONS} (active=${wss.clients.size}, pending=${pendingUpgrades}), memExhausted=${isMemoryExhausted}`)
		releaseUpgradeReservation()
		socket.write('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\n\r\n')
		socket.destroy()
		return
	}

	// 2. Parse URL params
	const url = new URL(request.url, `http://${request.headers.host}`)
	const token = url.searchParams.get('token')
	const documentId = url.searchParams.get('documentId')

	if (!token || !documentId) {
		releaseUpgradeReservation()
		socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
		socket.destroy()
		return
	}

	try {
		// Authenticate and verify role using client JWT
		const supabaseClient = getSupabaseClient(token)
		const { role, userId } = await verifyUserRole(supabaseClient, documentId, token)

		if (!role) {
			console.log(`[Connection] Access denied for doc ${documentId}`)
			releaseUpgradeReservation()
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
			socket.destroy()
			return
		}

		// Enforce distinct collaborator limit atomically via Postgres ledger
		const ownerPlan = await getDocumentOwnerPlan(supabaseAdmin, documentId)
		const limits = getPlanLimits(ownerPlan)

		const { allowed } = await admitCollaborator(
			supabaseAdmin,
			documentId,
			userId,
			limits.maxDistinctCollaborators
		)

		if (!allowed) {
			console.log(`[Connection] Rejected: Document ${documentId} reached max distinct collaborators (${limits.maxDistinctCollaborators}) for plan ${ownerPlan}`)
			releaseUpgradeReservation()
			socket.write('HTTP/1.1 403 Forbidden\r\nX-Reason: Upgrade Required\r\n\r\n')
			socket.destroy()
			return
		}

		console.log(`[Connection] User role: ${role} on doc ${documentId} (${userId})`)

		wss.handleUpgrade(request, socket, head, (ws) => {
			releaseUpgradeReservation()
			ws.isViewer = role === 'viewer'
			wss.emit('connection', ws, request)
		})
	} catch (err) {
		console.error('[Upgrade Error]', err)
		releaseUpgradeReservation()
		socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
		socket.destroy()
	}
})

wss.on('connection', (ws, request) => {
	// Intercept incoming messages to guard payload size and block Viewer writes
	const originalOnMessage = ws.on
	ws.on = function (event, listener) {
		if (event === 'message') {
			const wrappedListener = function (data, isBinary) {
				// 1. Enforce payload frame size ceiling
				const byteLength = data ? (data instanceof Buffer ? data.length : data.byteLength || 0) : 0
				if (byteLength > MAX_PAYLOAD_BYTES) {
					console.warn(`[Security] Rejected oversized payload (${byteLength} bytes > ${MAX_PAYLOAD_BYTES} max)`)
					ws.close(1009, 'Message Too Big')
					return
				}

				// 2. Block Viewer writes
				if (ws.isViewer && isBinary && data && data.length >= 2) {
					const messageType = data[0]
					const syncType = data[1]
					if (messageType === 0 && (syncType === 1 || syncType === 2)) {
						console.log('[Security] Rejected Viewer edit message payload')
						return
					}
				}
				listener.call(this, data, isBinary)
			}
			return originalOnMessage.call(this, event, wrappedListener)
		}
		return originalOnMessage.call(this, event, listener)
	}

	// Hand connection over to y-websocket setup
	const url = new URL(request.url, `http://${request.headers.host}`)
	const documentId = url.searchParams.get('documentId')
	
	// Create request wrapper to supply docName
	request.url = `/${documentId}`
	setupWSConnection(ws, request)
})

// LRU Eviction: periodically check for idle documents (no active clients) and evict them from memory
setInterval(() => {
	for (const [docName, doc] of docs.entries()) {
		if (doc.conns.size === 0) {
			console.log(`[LRU] Evicting idle document ${docName} from server memory`)
			docs.delete(docName)
		}
	}
}, 60000) // Run check every minute

// Background Retention Sweep (12-hour fallback interval)
setInterval(async () => {
	console.log('[Retention Sweep] Starting periodic background version cleanup...')
	try {
		for (const [docName] of docs.entries()) {
			const ownerPlan = await getDocumentOwnerPlan(supabaseAdmin, docName)
			if (ownerPlan) {
				await pruneExpiredDocumentVersions(supabaseAdmin, docName, ownerPlan, new Date())
			}
		}
	} catch (sweepErr) {
		console.warn('[Retention Sweep] Sweep error:', sweepErr)
	}
}, 12 * 60 * 60 * 1000)

// Catch termination signals to flush in-memory documents before exiting
async function gracefulShutdown () {
	console.log('\n[Shutdown] Flushing all active documents to Supabase...')
	const promises = []
	for (const [docName, doc] of docs.entries()) {
		clearSaveTimers(docName)
		promises.push(triggerSerializedSave(docName, doc))
	}
	const results = await Promise.allSettled(promises)
	const rejected = results.filter((r) => r.status === 'rejected')
	if (rejected.length > 0) {
		console.error(`[Shutdown] Warning: ${rejected.length} document saves failed during shutdown flush.`)
	}
	console.log('[Shutdown] All states flushed. Exiting.')
	process.exit(0)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)

if (require.main === module || (!process.env.VITEST && process.env.NODE_ENV !== 'test')) {
	server.listen(port, () => {
		console.log(`Sync Server listening on port ${port}`)
	})
}

module.exports = {
	server,
	wss,
	saveDocumentState,
	triggerSerializedSave,
	scheduleDebouncedSave,
	saveDebounceTimers,
	saveMaxThrottleTimers,
	clearSaveTimers,
	getServerMetrics,
	MAX_CONNECTIONS,
	MAX_PAYLOAD_BYTES,
}
