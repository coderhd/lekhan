import { createServer, type IncomingMessage } from 'node:http'
import { getHeapStatistics } from 'node:v8'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import * as Y from 'yjs'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as sync from 'y-protocols/sync'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { syncProtocol, verifySyncTicket, type SyncTicket } from '../../lib/sync/ticket.ts'
import type { RelayAccess } from '../../lib/sync/authority.ts'
import { imageLimitCloseCode } from '../../lib/sync/wire.ts'
import { cloudImageAllowed, type CloudImagePolicy } from '../../lib/cloud/image-policy.ts'
import { addedDocumentImages, documentImages, imageRoots } from './document-images.ts'
import type { encryptedWal } from './wal.ts'

const maxPayload = 10 * 1024 * 1024
const maxBuffered = 65 * 1024 * 1024
const maxSockets = 400
const syncMessage = 0
const awarenessMessage = 1
const queryAwareness = 3
const idleFlush = 2_000
const maxFlush = 10_000
const heartbeat = 15_000

interface HubOptions {
  secret: string
  origin: string
  wal: ReturnType<typeof encryptedWal>
  load: (pageId: string) => Promise<Uint8Array | null>
  persist: (pageId: string, doc: Y.Doc) => Promise<void>
  authorize: (ticket: SyncTicket, admission: boolean) => Promise<RelayAccess>
  imagePolicy?: (ticket: SyncTicket) => Promise<CloudImagePolicy | null>
  onFault?: (operation: string) => void
}

interface Peer {
  socket: WebSocket
  ticket: SyncTicket
  access: 'read' | 'write'
  cursorId?: number
  pending: number
  alive: boolean
  checking: boolean
}

function packet(type: number, bytes: Uint8Array) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  encoding.writeVarUint8Array(encoder, bytes)
  return encoding.toUint8Array(encoder)
}

function send(socket: WebSocket, bytes: Uint8Array) {
  if (socket.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount + bytes.byteLength > maxBuffered) {
    socket.close(1013, 'Connection is behind')
    return
  }
  socket.send(bytes, { binary: true })
}

function toBytes(data: RawData) {
  return Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data
}

function reject(socket: Duplex, status: string, reason?: string) {
  if (!socket.destroyed) {
    const detail = reason ? 'X-Reason: ' + reason + '\r\n' : ''
    socket.end('HTTP/1.1 ' + status + '\r\n' + detail + 'Connection: close\r\nContent-Length: 0\r\n\r\n')
  }
}

class Room {
  private doc = new Y.Doc()
  private roots = imageRoots(this.doc)
  private images = documentImages(this.roots)
  private readonly cursorDoc = new Y.Doc()
  private readonly cursor = new Awareness(this.cursorDoc)
  readonly peers = new Set<Peer>()
  readonly cursorOwners = new Map<number, Peer>()
  lastUse = Date.now()
  private tail: Promise<unknown> = Promise.resolve()
  private dirtySince = 0
  private retired = false
  private timer: ReturnType<typeof setTimeout> | undefined

  readonly pageId: string
  private readonly options: HubOptions
  private readonly invalidate: () => void

  constructor(pageId: string, options: HubOptions, invalidate: () => void) {
    this.pageId = pageId
    this.options = options
    this.invalidate = invalidate
    this.cursor.setLocalState(null)
    this.cursor.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const ids = [...added, ...updated, ...removed]
      if (ids.length) this.broadcast(packet(awarenessMessage, encodeAwarenessUpdate(this.cursor, ids)))
    })
  }

  async hydrate() {
    await this.recoverDocument()
    if (this.dirtySince) this.scheduleFlush()
  }

  private async recoverDocument() {
    const recovered = new Y.Doc()
    try {
      const roots = imageRoots(recovered)
      const snapshot = await this.options.load(this.pageId)
      if (snapshot) Y.applyUpdate(recovered, snapshot)
      await this.options.wal.replay(this.pageId, update => {
        Y.applyUpdate(recovered, update)
        this.dirtySince ||= Date.now()
      })
      const images = documentImages(roots)
      this.doc.destroy()
      this.doc = recovered
      this.roots = roots
      this.images = images
    } catch (error) {
      recovered.destroy()
      throw error
    }
  }

  private sequence<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task)
    this.tail = result.catch(() => undefined)
    return result
  }

  broadcast(bytes: Uint8Array, skip?: unknown) {
    for (const peer of this.peers) if (peer !== skip) send(peer.socket, bytes)
  }

  private scheduleFlush(retryDelay?: number) {
    if (this.timer) clearTimeout(this.timer)
    const delay = retryDelay ?? Math.max(0, Math.min(idleFlush, this.dirtySince + maxFlush - Date.now()))
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush().catch(() => {
        this.options.onFault?.('persist')
        if (this.dirtySince && !this.timer) this.scheduleFlush(maxFlush)
      })
    }, delay)
    this.timer.unref()
  }

  flush() {
    return this.sequence(async () => {
      if (!this.dirtySince || this.retired) return
      await this.options.persist(this.pageId, this.doc)
      await this.options.wal.clear(this.pageId)
      this.dirtySince = 0
    })
  }

  get canEvict() {
    return !this.peers.size && !this.dirtySince && Date.now() - this.lastUse > 60_000
  }

  show(peer: Peer) {
    void this.sequence(async () => {
      if (peer.socket.readyState !== WebSocket.OPEN) return
      if (this.retired) return peer.socket.close(1013, 'Reloading page')
      this.peers.add(peer)
      this.lastUse = Date.now()
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, syncMessage)
      sync.writeSyncStep1(encoder, this.doc)
      send(peer.socket, encoding.toUint8Array(encoder))
      this.sendCursors(peer)
    })
  }

  remove(peer: Peer) {
    if (this.retired) return
    this.peers.delete(peer)
    this.lastUse = Date.now()
    if (peer.cursorId !== undefined) {
      this.cursorOwners.delete(peer.cursorId)
      removeAwarenessStates(this.cursor, [peer.cursorId], peer)
    }
  }

  private sendCursors(peer: Peer) {
    const ids = [...this.cursor.getStates().keys()]
    if (ids.length) send(peer.socket, packet(awarenessMessage, encodeAwarenessUpdate(this.cursor, ids)))
  }

  private receiveCursor(peer: Peer, bytes: Uint8Array) {
    if (bytes.byteLength > 16_384) throw new Error('Cursor message exceeds limit.')
    const probe = decoding.createDecoder(bytes)
    const count = decoding.readVarUint(probe)
    if (count > 64) throw new Error('Too many cursor records.')
    for (let index = 0; index < count; index++) {
      const id = decoding.readVarUint(probe)
      const clock = decoding.readVarUint(probe)
      const state = decoding.readVarString(probe)
      // y-websocket echoes awareness updates. A connection may change only its own cursor.
      const assigned = this.cursorOwners.get(id)
      if (assigned && assigned !== peer) continue
      if (peer.cursorId !== undefined && peer.cursorId !== id) continue
      if (peer.cursorId === undefined && (count !== 1 || state === 'null')) continue
      const single = encoding.createEncoder()
      encoding.writeVarUint(single, 1)
      encoding.writeVarUint(single, id)
      encoding.writeVarUint(single, clock)
      encoding.writeVarString(single, state)
      this.cursorOwners.set(id, peer)
      peer.cursorId = id
      applyAwarenessUpdate(this.cursor, encoding.toUint8Array(single), peer)
    }
  }

  receive(peer: Peer, data: Uint8Array) {
    return this.sequence(async () => {
      if (this.retired || peer.socket.readyState !== WebSocket.OPEN || peer.ticket.exp * 1000 <= Date.now()) return
      this.lastUse = Date.now()
      const decoder = decoding.createDecoder(data)
      const type = decoding.readVarUint(decoder)

      if (type === awarenessMessage) {
        this.receiveCursor(peer, decoding.readVarUint8Array(decoder))
        return
      }
      if (type === queryAwareness) {
        this.sendCursors(peer)
        return
      }
      if (type !== syncMessage) throw new Error('Unknown sync message.')
      const step = decoding.readVarUint(decoder)
      const update = decoding.readVarUint8Array(decoder)
      if (decoding.hasContent(decoder)) throw new Error('Unexpected sync data.')
      if (step === sync.messageYjsSyncStep1) {
        const reply = encoding.createEncoder()
        encoding.writeVarUint(reply, syncMessage)
        sync.writeSyncStep2(reply, this.doc, update)
        send(peer.socket, encoding.toUint8Array(reply))
        return
      }
      if (step !== sync.messageYjsSyncStep2 && step !== sync.messageYjsUpdate) throw new Error('Unknown sync step.')
      if (peer.access !== 'write') return

      const decoded = Y.decodeUpdate(update)
      if (!decoded.structs.length && !decoded.ds.clients.size) return
      let accepted: Uint8Array | undefined
      let changed: ReadonlySet<unknown> | undefined
      const capture = (result: Uint8Array, _origin: unknown, _doc: Y.Doc, transaction: Y.Transaction) => {
        accepted = result
        changed = new Set(transaction.changedParentTypes.keys())
      }
      try {
        this.doc.on('update', capture)
        try {
          Y.applyUpdate(this.doc, update, peer)
        } finally {
          this.doc.off('update', capture)
        }
        // Keep incomplete deltas out of both snapshots and the WAL. A fresh
        // state-vector exchange lets the client send the missing dependencies.
        if (this.doc.store.pendingStructs || this.doc.store.pendingDs) {
          await this.recoverDocument()
          peer.socket.close(4001, 'Resync required')
          return
        }
        if (!accepted) return

        const nextImages = documentImages(this.roots, this.images, changed)
        if (this.options.imagePolicy) {
          const additions = [...addedDocumentImages(this.images, nextImages)]
          if (additions.length) {
            const policy = await this.options.imagePolicy(peer.ticket).catch(() => undefined)
            if (!policy || additions.some(source => !cloudImageAllowed(source, policy))) {
              // The speculative document has never been persisted or exposed
              // to another peer. Recover it without disconnecting the room.
              await this.recoverDocument()
              if (policy === null) peer.socket.close(4003, 'Page access changed')
              else if (policy === undefined) peer.socket.close(1013, 'Could not check cloud image limits')
              else peer.socket.close(imageLimitCloseCode, policy)
              return
            }
          }
        }
        await this.options.wal.append(this.pageId, accepted)
        this.images = nextImages
      } catch (failure) {
        // A failed integration or append may have changed the in-memory document.
        // Recover from the durable state before the room serves any further reads.
        this.retired = true
        for (const connected of this.peers) connected.socket.close(1013, 'Reloading page')
        this.peers.clear()
        this.destroy()
        this.invalidate()
        throw failure
      }
      this.dirtySince ||= Date.now()
      this.scheduleFlush()
      if (accepted) {
        const reply = encoding.createEncoder()
        encoding.writeVarUint(reply, syncMessage)
        sync.writeUpdate(reply, accepted)
        this.broadcast(encoding.toUint8Array(reply), peer)
      }
    })
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer)
    this.cursor.destroy()
    this.cursorDoc.destroy()
    this.doc.destroy()
  }
}

function identify(request: IncomingMessage) {
  const protocols = request.headers['sec-websocket-protocol']?.split(',').map(value => value.trim())
  if (!protocols || protocols.length !== 2 || protocols[0] !== syncProtocol) return null
  const path = request.url ?? ''
  if (!/^\/[a-f\d-]{36}$/i.test(path)) return null
  return { pageId: path.slice(1), ticket: protocols[1] }
}

export function createSyncHub(options: HubOptions) {
  const rooms = new Map<string, Promise<Room>>()
  let pending = 0
  let closing = false
  const connections = new Set<Peer>()
  const socketServer = new WebSocketServer({
    noServer: true,
    maxPayload,
    perMessageDeflate: false,
    handleProtocols: protocols => protocols.has(syncProtocol) ? syncProtocol : false,
  })

  function overloaded() {
    const memory = process.memoryUsage()
    const memoryLimitMb = Number(process.env.LEKHAN_SYNC_MEMORY_LIMIT_MB || 0)
    return memory.heapUsed >= getHeapStatistics().heap_size_limit * 0.9
      || (memoryLimitMb > 0 && memory.rss >= memoryLimitMb * 1024 * 1024)
  }

  const server = createServer((req, response) => {
    const healthy = !closing && connections.size + pending < maxSockets && !overloaded()
    const found = req.url === '/health' && req.method === 'GET'
    response.writeHead(found ? healthy ? 200 : 503 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(found ? { ok: healthy } : { error: 'not_found' }))
  })

  function openRoom(pageId: string) {
    let room = rooms.get(pageId)
    if (!room) {
      const created = new Room(pageId, options, () => { if (rooms.get(pageId) === room) rooms.delete(pageId) })
      room = created.hydrate().then(() => created).catch(error => {
        created.destroy()
        rooms.delete(pageId)
        throw error
      })
      rooms.set(pageId, room)
    }
    return room
  }

  server.on('upgrade', async (request, socket, head) => {
    if (closing || pending + connections.size >= maxSockets || overloaded()) return reject(socket, '503 Service Unavailable')
    if (request.headers.origin !== options.origin) return reject(socket, '403 Forbidden')
    const target = identify(request)
    const ticket = target && verifySyncTicket(options.secret, target.ticket, target.pageId)
    if (!ticket) return reject(socket, '401 Unauthorized')

    pending++
    const expired = setTimeout(() => reject(socket, '503 Service Unavailable'), 15_000)
    try {
      const access = await options.authorize(ticket, true)
      if (access === 'limit') return reject(socket, '403 Forbidden', 'Upgrade Required')
      if (!access) return reject(socket, '403 Forbidden')
      const room = await openRoom(ticket.pageId)
      if (socket.destroyed || socket.writableEnded || closing) return
      if (ticket.exp * 1000 <= Date.now()) return reject(socket, '401 Unauthorized')
      socketServer.handleUpgrade(request, socket, head, ws => {
        const peer: Peer = { socket: ws, ticket, access, pending: 0, alive: true, checking: false }
        connections.add(peer)
        ws.on('close', () => {
          connections.delete(peer)
          room.remove(peer)
        })
        ws.on('error', () => ws.close())
        ws.on('pong', () => { peer.alive = true })
        ws.on('message', (message, binary) => {
          if (!binary || peer.pending >= 20) return ws.close(1008, 'Invalid or excessive messages')
          peer.pending++
          void room.receive(peer, toBytes(message)).catch(() => {
            options.onFault?.('receive')
            ws.close(1011, 'Could not accept update')
          }).finally(() => { peer.pending-- })
        })
        room.show(peer)
      })
    } catch {
      options.onFault?.('open')
      reject(socket, '503 Service Unavailable')
    } finally {
      clearTimeout(expired)
      pending--
    }
  })

  const monitor = setInterval(() => {
    for (const peer of connections) {
      if (!peer.alive) {
        peer.socket.terminate()
        continue
      }
      if (peer.ticket.exp * 1000 <= Date.now()) {
        peer.socket.close(4001, 'Ticket expired')
        continue
      }
      peer.alive = false
      peer.socket.ping()
      // y-websocket's browser watchdog sees application messages only.
      send(peer.socket, packet(awarenessMessage, Uint8Array.of(0)))
      if (peer.checking) continue
      peer.checking = true
      void options.authorize(peer.ticket, false).then(access => {
        if (access !== peer.access) peer.socket.close(4003, 'Page access changed')
      }).catch(() => peer.socket.close(1013, 'Could not verify page access')).finally(() => { peer.checking = false })
    }
    for (const [pageId, pendingRoom] of rooms) void pendingRoom.then(room => {
      if (room.canEvict && rooms.get(pageId) === pendingRoom) {
        rooms.delete(pageId)
        room.destroy()
      }
    }).catch(() => undefined)
  }, heartbeat)
  monitor.unref()

  return {
    server,
    async close() {
      closing = true
      clearInterval(monitor)
      for (const peer of connections) peer.socket.terminate()
      const closed = new Promise<void>((resolve, rejectClose) => {
        server.close(error => error ? rejectClose(error) : resolve())
      })
      const roomFlush = await Promise.allSettled([...rooms.values()].map(async roomPromise => {
        const room = await roomPromise
        try { await room.flush() } finally { room.destroy() }
      }))
      socketServer.close()
      await closed
      return roomFlush.every(result => result.status === 'fulfilled')
    },
  }
}
