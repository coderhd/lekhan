const http = require('http')
const WebSocket = require('ws')
const Y = require('yjs')
const { setupWSConnection, docs } = require('y-websocket/bin/utils')
const { createClient } = require('@supabase/supabase-js')
const { getSupabaseClient, verifyUserRole, getDocumentOwnerPlan } = require('./auth')
const { getPlanLimits } = require('../lib/tier-limits.ts')
const { pruneExpiredDocumentVersions } = require('./retention.js')
const { getDistinctCollaboratorsCount, isCollaboratorRegistered, recordCollaboratorAccess } = require('./ledger.js')
const graphIndex = require('./graph-index')
const { encryptSnapshot, decryptSnapshot } = require('./crypto')

const port = process.env.PORT || 8080
const MAX_CONNECTIONS = 1500
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024 // 10 MB payload guard

// Initialize privileged Supabase client for backend operations
const supabaseAdmin = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL,
	process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
	{
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	}
)

const wss = new WebSocket.Server({ noServer: true })

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

// Health and metrics helper
function getServerMetrics () {
	const mem = process.memoryUsage()
	const heapTotal = mem.heapTotal || 1
	const heapUsed = mem.heapUsed || 0
	const heapUtilizationPct = Math.round((heapUsed / heapTotal) * 100)

	return {
		status: 'ok',
		uptimeSeconds: Math.floor(process.uptime()),
		activeDocuments: docs.size,
		activeConnections: wss.clients.size,
		memory: {
			rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
			heapUsedMb: Math.round((heapUsed / (1024 * 1024)) * 10) / 10,
			heapTotalMb: Math.round((heapTotal / (1024 * 1024)) * 10) / 10,
		},
		limits: {
			maxConnections: MAX_CONNECTIONS,
			heapUtilizationPct,
		},
	}
}

const server = http.createServer((req, res) => {
	if (req.url === '/health' || req.url === '/metrics') {
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify(getServerMetrics(), null, 2))
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
	}
}

// Hook into Yjs document initialization
const { setPersistence } = require('y-websocket/bin/utils')

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

		// 2. Attach change listener to trigger capped debounced saves
		ydoc.on('update', (update, origin) => {
			// Skip saving if the update originated from the server loading base state
			if (origin === 'supabase-load') {
				return
			}

			// Clear previous idle debounce timer
			if (saveDebounceTimers.has(documentId)) {
				clearTimeout(saveDebounceTimers.get(documentId))
			}

			// Schedule hard 10-second max-throttle if not already running
			if (!saveMaxThrottleTimers.has(documentId)) {
				const maxThrottleTimer = setTimeout(async () => {
					clearSaveTimers(documentId)
					await saveDocumentState(documentId, ydoc)
				}, 10000)
				saveMaxThrottleTimers.set(documentId, maxThrottleTimer)
			}

			// Set 2-second idle debounce save
			const debounceTimer = setTimeout(async () => {
				clearSaveTimers(documentId)
				await saveDocumentState(documentId, ydoc)
			}, 2000)

			saveDebounceTimers.set(documentId, debounceTimer)
		})
	},
	writeState: async (documentId, ydoc) => {
		clearSaveTimers(documentId)
		await saveDocumentState(documentId, ydoc)
	},
})

server.on('upgrade', async (request, socket, head) => {
	// 1. Concurrency & Load-Shedding Protection
	const mem = process.memoryUsage()
	const isMemoryExhausted = mem.heapTotal > 0 && (mem.heapUsed / mem.heapTotal) > 0.85
	if (wss.clients.size >= MAX_CONNECTIONS || isMemoryExhausted) {
		console.warn(`[LoadShedding] Connection rejected: connections=${wss.clients.size}/${MAX_CONNECTIONS}, memExhausted=${isMemoryExhausted}`)
		socket.write('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\n\r\n')
		socket.destroy()
		return
	}

	// 2. Parse URL params
	const url = new URL(request.url, `http://${request.headers.host}`)
	const token = url.searchParams.get('token')
	const documentId = url.searchParams.get('documentId')

	if (!token || !documentId) {
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
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
			socket.destroy()
			return
		}

		// Enforce distinct collaborator limit based on document owner plan via Postgres ledger
		const ownerPlan = await getDocumentOwnerPlan(supabaseAdmin, documentId)
		const limits = getPlanLimits(ownerPlan)

		const isRegistered = await isCollaboratorRegistered(supabaseAdmin, documentId, userId)
		const currentCount = await getDistinctCollaboratorsCount(supabaseAdmin, documentId)

		if (!isRegistered && currentCount >= limits.maxDistinctCollaborators) {
			console.log(`[Connection] Rejected: Document ${documentId} reached max distinct collaborators (${limits.maxDistinctCollaborators}) for plan ${ownerPlan}`)
			socket.write('HTTP/1.1 4403 Forbidden\r\nX-Reason: Upgrade Required\r\n\r\n')
			socket.destroy()
			return
		}

		if (!isRegistered && userId !== 'anonymous') {
			await recordCollaboratorAccess(supabaseAdmin, documentId, userId)
		}

		console.log(`[Connection] User role: ${role} on doc ${documentId} (${currentCount}/${limits.maxDistinctCollaborators} distinct)`)

		wss.handleUpgrade(request, socket, head, (ws) => {
			ws.isViewer = role === 'viewer'
			wss.emit('connection', ws, request)
		})
	} catch (err) {
		console.error('[Upgrade Error]', err)
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
		promises.push(saveDocumentState(docName, doc))
	}
	await Promise.allSettled(promises)
	console.log('[Shutdown] All states flushed. Exiting.')
	process.exit(0)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)

server.listen(port, () => {
	console.log(`Sync Server listening on port ${port}`)
})

module.exports = { server, wss, saveDocumentState, clearSaveTimers, getServerMetrics }
