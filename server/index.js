const http = require('http')
const WebSocket = require('ws')
const Y = require('yjs')
const { setupWSConnection, docs } = require('y-websocket/bin/utils')
const { createClient } = require('@supabase/supabase-js')
const { getSupabaseClient, verifyUserRole, getDocumentOwnerPlanLimit } = require('./auth')

const { appendUpdate, getPendingUpdates, clearUpdates } = require('./wal')
const { indexPage } = require('./graph-index')

const port = process.env.PORT || 8080

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

const server = http.createServer((req, res) => {
	res.writeHead(200, { 'Content-Type': 'text/plain' })
	res.end('WebSocket Sync Server Running\n')
})

const wss = new WebSocket.Server({ noServer: true })

// Cache save timers
const saveDebounceTimers = new Map()

// Helper to save document state to Supabase Storage and update text index
async function saveDocumentState (documentId, ydoc) {
	try {
		console.log(`[Sync] Saving document ${documentId} to Supabase...`)
		
		// 1. Encode Yjs state to binary
		const stateUpdate = Y.encodeStateAsUpdate(ydoc)
		const buffer = Buffer.from(stateUpdate)

		// 2. Upload binary to Supabase Storage documents bucket
		const { error: uploadError } = await supabaseAdmin.storage
			.from('documents')
			.upload(`${documentId}/main_state.bin`, buffer, {
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
			await supabaseAdmin
				.from('pages')
				.update({
					searchable_text: textContent,
					updated_at: new Date().toISOString(),
				})
				.eq('id', documentId)

			await indexPage(supabaseAdmin, documentId, textContent)
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

		// 4. Clear pending local WAL logs now that Supabase is synced
		clearUpdates(documentId)
		console.log(`[Sync] Document ${documentId} successfully synced to Supabase.`)
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

			// 1. Fetch base Yjs state from Supabase Storage
			const { data, error } = await supabaseAdmin.storage
				.from('documents')
				.download(`${documentId}/main_state.bin`)

			if (data) {
				const arrayBuffer = await data.arrayBuffer()
				const uint8Array = new Uint8Array(arrayBuffer)
				Y.applyUpdate(ydoc, uint8Array, 'supabase-load')
				console.log(`[Persist] Base state applied for ${documentId}`)
			} else if (error && error.status !== 404) {
				// Log errors other than file not found (new document)
				console.error(`[Persist Error] Download failed for ${documentId}:`, error)
			}

			// 2. Apply pending local updates from WAL cache
			const pending = getPendingUpdates(documentId)
			if (pending.length > 0) {
				console.log(`[Persist] Applying ${pending.length} pending WAL updates for ${documentId}`)
				pending.forEach(update => {
					Y.applyUpdate(ydoc, update, 'wal-load')
				})
			}

			console.log(`[Persist] Document ${documentId} fully loaded.`)
		} catch (err) {
			console.error(`[Persist Error] Failed to bind state for ${documentId}:`, err)
		}

		// 3. Attach change listener to trigger local WAL log and debounced saves
		ydoc.on('update', (update, origin) => {
			// Skip saving if the update originated from the server loading base state
			if (origin === 'supabase-load' || origin === 'wal-load') {
				return
			}

			// Append to local Write-Ahead Log instantly
			appendUpdate(documentId, update)

			// Clear previous debounce timer
			if (saveDebounceTimers.has(documentId)) {
				clearTimeout(saveDebounceTimers.get(documentId))
			}

			// Set 10-minute maximum throttle and 3-second debounce save
			const timer = setTimeout(async () => {
				saveDebounceTimers.delete(documentId)
				await saveDocumentState(documentId, ydoc)
			}, 3000)

			saveDebounceTimers.set(documentId, timer)
		})
	},
	writeState: async (documentId, ydoc) => {
		// Clean up save timer and force write immediately
		if (saveDebounceTimers.has(documentId)) {
			clearTimeout(saveDebounceTimers.get(documentId))
			saveDebounceTimers.delete(documentId)
		}
		await saveDocumentState(documentId, ydoc)
	},
})

server.on('upgrade', async (request, socket, head) => {
	// Parse URL params
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
		const role = await verifyUserRole(supabaseClient, documentId, token)

		if (!role) {
			console.log(`[Connection] Access denied for doc ${documentId}`)
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
			socket.destroy()
			return
		}

		// Enforce concurrent collaborator limit based on document owner plan
		const activeConns = docs.get(documentId)?.conns.size || 0
		const maxConcurrent = await getDocumentOwnerPlanLimit(supabaseAdmin, documentId)

		if (activeConns >= maxConcurrent) {
			console.log(`[Connection] Rejected: Document ${documentId} reached max active connections (${maxConcurrent}) for owner plan`)
			socket.write('HTTP/1.1 403 Forbidden\r\nX-Reason: Concurrent collaborator limit reached\r\n\r\n')
			socket.destroy()
			return
		}

		console.log(`[Connection] User role: ${role} on doc ${documentId} (${activeConns + 1}/${maxConcurrent} active)`)

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
	// Intercept incoming messages to block Viewer writes
	const originalOnMessage = ws.on
	ws.on = function (event, listener) {
		if (event === 'message') {
			const wrappedListener = function (data, isBinary) {
				if (ws.isViewer && isBinary && data && data.length >= 2) {
					const messageType = data[0]
					const syncType = data[1]
					// Yjs Sync Protocol message structure:
					// data[0] === 0 (messageYjsSync)
					// data[1] === 1 (messageYjsSyncStep2) or 2 (messageYjsSyncUpdate)
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
			// Persistence writeState is automatically called when document is removed
			docs.delete(docName)
		}
	}
}, 60000) // Run check every minute

// Catch termination signals to flush in-memory documents before exiting
async function gracefulShutdown () {
	console.log('\n[Shutdown] Flushing all active documents to Supabase...')
	const promises = []
	for (const [docName, doc] of docs.entries()) {
		if (saveDebounceTimers.has(docName)) {
			clearTimeout(saveDebounceTimers.get(docName))
			saveDebounceTimers.delete(docName)
		}
		promises.push(saveDocumentState(docName, doc))
	}
	await Promise.all(promises)
	console.log('[Shutdown] All states flushed. Exiting.')
	process.exit(0)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)

server.listen(port, () => {
	console.log(`Sync Server listening on port ${port}`)
})
