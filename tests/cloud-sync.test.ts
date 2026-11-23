import { mkdtemp, rm, readFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { WebSocket } from 'ws'
import { WebsocketProvider } from 'y-websocket'
import { createClient } from '@supabase/supabase-js'
import { issueSyncTicket, verifySyncTicket } from '../lib/sync/ticket'
import { chunkedSocket } from '../lib/sync/chunked-socket'
import { PAID_IMAGE_BYTES } from '../lib/cloud/image-policy'
import { imageLimitCloseCode, maxSyncFrameBytes, syncChunkBytes, syncChunkHeaderBytes, syncChunkMessage, syncProtocol } from '../lib/sync/wire'
import { createSyncHub } from '../server/sync/hub'
import { snapshotCipher } from '../server/sync/snapshot'
import { encryptedWal } from '../server/sync/wal'
import { replaceCheckpointContent } from '../lib/cloud/checkpoints'
import { openCheckpointTransfer, sealCheckpointTransfer } from '../server/sync/checkpoint-ticket'
import { getExpirationCutoffDate } from '../lib/tier-limits'
import { pruneExpiredCheckpoints } from '../server/sync/prune-checkpoints'
import { uploadDocumentObject } from '../server/sync/storage-capacity'
import { attachmentName, attachmentPartBytes, attachmentPaths, PAID_ATTACHMENT_BYTES } from '../lib/cloud/attachments'
import { pruneAttachments } from '../server/sync/prune-attachments'

const pageId = 'e6a3a67a-bf74-4f17-b013-95eb59b2e937'
const owner = 'dc885a37-7b5a-4897-8d83-3cca664c0251'
const viewer = '8f20ce73-276c-428c-85b7-451fb0c1bd26'
const secret = 'a fixture secret with thirty-two characters'
const previousKey = 'an independent previous encryption secret for tests'
const origin = 'http://127.0.0.1:3322'
const bytes = (value: string) => new TextEncoder().encode(value)
const cleanup: Array<() => void | Promise<unknown>> = []

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.()
})

describe('sync capabilities and storage', () => {
  it('binds authenticated tickets to a page and expiry', () => {
    const ticket = issueSyncTicket(secret, { pageId, subject: owner, role: 'editor' }, 1000)
    expect(verifySyncTicket(secret, ticket, pageId, 1001)).toEqual({ pageId, subject: owner, role: 'editor', exp: 1300 })
    expect(verifySyncTicket(secret, ticket, viewer, 1001)).toBeNull()
    expect(verifySyncTicket(secret, ticket, pageId, 1300)).toBeNull()
    expect(verifySyncTicket(previousKey, ticket, pageId, 1001)).toBeNull()
  })

  it('encrypts WAL records with page binding and reads the legacy snapshot format during rotation', () => {
    const old = snapshotCipher(previousKey)
    const fresh = snapshotCipher(secret, [previousKey])
    const payload = bytes('private page text')
    const legacy = old.seal(payload, 'snapshot:' + pageId, true)
    expect(legacy.subarray(0, 8).toString()).toBe('LK_ENC_1')
    expect(legacy.includes('private page text')).toBe(false)
    expect(Buffer.from(fresh.open(legacy, 'snapshot:' + pageId)).equals(payload)).toBe(true)
    const bound = fresh.seal(payload, 'wal:' + pageId)
    expect(() => fresh.open(bound, 'wal:' + viewer, false)).toThrow('authentication failed')
    expect(Buffer.from(fresh.open(bound, 'wal:' + pageId, false)).equals(payload)).toBe(true)
  })

  it('replays complete encrypted records and cuts a torn final append before writing again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lekhan-sync-wal-'))
    cleanup.push(() => rm(dir, { force: true, recursive: true }))
    const wal = encryptedWal(dir, snapshotCipher(secret))
    await wal.append(pageId, bytes('first private edit'))
    const path = join(dir, pageId + '.wal')
    expect((await readFile(path)).includes('first private edit')).toBe(false)
    await appendFile(path, Buffer.from([0, 0, 0, 64, 3, 8, 9]))
    const result: string[] = []
    await wal.replay(pageId, update => result.push(Buffer.from(update).toString()))
    await wal.append(pageId, bytes('second edit'))
    await wal.replay(pageId, update => result.push(Buffer.from(update).toString()))
    expect(result).toEqual(['first private edit', 'first private edit', 'second edit'])
  })

  it('only sends object bytes after a reservation and retains the lease on ambiguous upload failures', async () => {
    const calls: string[] = []
    const object = pageId + '/main_state.bin'
    const payload = bytes('encrypted snapshot')
    let leaseId = ''
    let decision = 'full'
    let storageStatus = 200
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/rebuild_reserve_document_upload')) {
        calls.push('reserve')
        const args = JSON.parse(String(init?.body))
        expect(args).toMatchObject({ target_path: object, proposed_bytes: payload.length, replace_existing: false })
        leaseId = args.proposed_lease
        return Response.json(decision)
      }
      if (url.endsWith('/rebuild_release_document_upload')) {
        calls.push('release')
        expect(JSON.parse(String(init?.body))).toEqual({ completed_lease: leaseId })
        return new Response(null, { status: 204 })
      }
      expect(url).toContain('/storage/v1/object/documents/' + object)
      expect(init?.body).toEqual(payload)
      calls.push('upload')
      return Response.json(storageStatus === 200 ? { Key: 'documents/' + object } : {
        message: 'Storage refused the request', statusCode: String(storageStatus),
      }, { status: storageStatus })
    }
    const client = createClient('https://fixture.example', 'sb_secret_fixture', {
      auth: { persistSession: false }, global: { fetch: fetcher as typeof fetch },
    })
    await expect(uploadDocumentObject(client, object, payload, false)).rejects.toMatchObject({ reason: 'full' })
    expect(calls.splice(0)).toEqual(['reserve'])
    decision = 'exists'
    await expect(uploadDocumentObject(client, object, payload, false)).resolves.toBe('exists')
    expect(calls.splice(0)).toEqual(['reserve'])
    decision = 'reserved'
    await expect(uploadDocumentObject(client, object, payload, false)).resolves.toBe('uploaded')
    expect(calls.splice(0)).toEqual(['reserve', 'upload', 'release'])
    storageStatus = 503
    await expect(uploadDocumentObject(client, object, payload, false)).rejects.toThrow('Storage refused')
    expect(calls.splice(0)).toEqual(['reserve', 'upload'])
    storageStatus = 403
    await expect(uploadDocumentObject(client, object, payload, false)).rejects.toThrow('Storage refused')
    expect(calls.splice(0)).toEqual(['reserve', 'upload', 'release'])
  })
})

describe('cloud attachments', () => {
  it('uses generated part paths and retains cleanup claims if Storage fails', async () => {
    expect(attachmentName(' résumé.zip ')).toBe('résumé.zip')
    expect(attachmentName('../private')).toBeNull()
    expect(attachmentName('bad\\path')).toBeNull()
    expect(attachmentName('bad\nheader')).toBeNull()
    expect(attachmentPaths(pageId, owner, PAID_ATTACHMENT_BYTES)).toHaveLength(12)
    const expected = attachmentPaths(pageId, owner, attachmentPartBytes + 1)
    let batch: string
    let storageOffline = true
    let completed = false
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      const body = JSON.parse(String(init?.body))
      if (url.pathname.endsWith('/rebuild_claim_attachment_cleanup')) {
        batch = body.batch
        return Response.json([{ id: owner, page_id: pageId, byte_count: attachmentPartBytes + 1 }])
      }
      if (url.pathname.endsWith('/object/documents')) {
        expect(body.prefixes).toEqual(expected)
        if (storageOffline) return Response.json({ message: 'Storage offline' }, { status: 503 })
        return Response.json([])
      }
      expect(url.pathname).toContain('/rebuild_complete_attachment_cleanup')
      expect(body).toEqual({ batch, removed: [owner] })
      completed = true
      return new Response(null, { status: 204 })
    }
    const client = createClient('https://fixture.example', 'sb_secret_fixture', {
      auth: { persistSession: false }, global: { fetch: fetcher as typeof fetch },
    })
    await expect(pruneAttachments(client)).resolves.toEqual({ removed: 0, failures: 1 })
    expect(completed).toBe(false)
    storageOffline = false
    await expect(pruneAttachments(client)).resolves.toEqual({ removed: 1, failures: 0 })
    expect(completed).toBe(true)
  })
})

describe('cloud checkpoints', () => {
  it('keeps checkpoint transfer credentials opaque and valid only until expiry', () => {
    const cipher = snapshotCipher(secret)
    const operation = {
      method: 'POST' as const, page: pageId, version: viewer, subject: owner,
      name: 'Working draft', accessToken: 'a user access token used for row level security',
    }
    const now = 1000
    const token = sealCheckpointTransfer(cipher, operation, now)
    expect(Buffer.from(token, 'base64url').includes(operation.accessToken)).toBe(false)
    const transfer = openCheckpointTransfer(cipher, token, now)
    expect(transfer).toMatchObject(operation)
    expect(openCheckpointTransfer(cipher, token, transfer!.until)).toBeNull()
    const altered = Buffer.from(token, 'base64url')
    altered[altered.length - 1] ^= 1
    expect(openCheckpointTransfer(cipher, altered.toString('base64url'), now)).toBeNull()
    expect(openCheckpointTransfer(cipher, issueSyncTicket(secret, { pageId, subject: owner, role: 'editor' }), now)).toBeNull()
    expect(openCheckpointTransfer(snapshotCipher(previousKey), token, now)).toBeNull()
  })

  it('restores formatted blocks as a replica update and supports source-only snapshots', () => {
    const checkpoint = new Y.Doc()
    const active = new Y.Doc()
    const peer = new Y.Doc()
    for (const doc of [checkpoint, active, peer]) cleanup.push(() => doc.destroy())
    const paragraph = new Y.XmlElement('paragraph')
    const text = new Y.XmlText()
    paragraph.insert(0, [text])
    checkpoint.getXmlFragment('default').insert(0, [paragraph])
    text.insert(0, 'A previous draft', { bold: {} })

    active.getMap('lekhan').set('mode', 'source')
    active.getMap('lekhan').set('frontmatter', '---\ntags: [lab]\n---\n')
    active.getText('source').insert(0, 'Working draft')
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(active))
    const backup = new Y.Doc()
    cleanup.push(() => backup.destroy())
    Y.applyUpdate(backup, Y.encodeStateAsUpdate(active))

    replaceCheckpointContent(active, checkpoint, 'test restore')
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(active, Y.encodeStateVector(peer)))
    const restored = peer.getXmlFragment('default').get(0) as Y.XmlElement
    expect((restored.get(0) as Y.XmlText).toDelta()).toEqual([{ insert: 'A previous draft', attributes: { bold: {} } }])
    expect(peer.getMap('lekhan').has('mode')).toBe(false)
    expect(peer.getMap('lekhan').has('frontmatter')).toBe(false)
    expect(peer.getText('source').length).toBe(0)

    replaceCheckpointContent(active, backup, 'test backup restore')
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(active, Y.encodeStateVector(peer)))
    expect(peer.getText('source').toString()).toBe('Working draft')
    expect(peer.getMap('lekhan').get('frontmatter')).toBe('---\ntags: [lab]\n---\n')
    expect(peer.getXmlFragment('default').length).toBe(0)
  })

  it('restores a source checkpoint without resending the image next to an edit', () => {
    const saved = new Y.Doc()
    const active = new Y.Doc()
    const replica = new Y.Doc()
    for (const doc of [saved, active, replica]) cleanup.push(() => doc.destroy())
    const source = '![Attachment](data:image/png;base64,' + 'AAAA'.repeat(100_000) + ')'
    const savedText = saved.getText('source')
    savedText.insert(0, source + '\nOriginal 🪶')
    const activeText = active.getText('source')
    activeText.insert(0, source + '\nEdited 💡')
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(active))

    replaceCheckpointContent(active, saved, 'test restore')
    const delta = Y.encodeStateAsUpdate(active, Y.encodeStateVector(replica))
    expect(delta.byteLength).toBeLessThan(500)
    Y.applyUpdate(replica, delta)
    expect(replica.getText('source').toString() === savedText.toString()).toBe(true)
  })

  it('uses elapsed retention days for every tier', () => {
    const clock = new Date('2026-03-09T04:30:00.000Z')
    expect(getExpirationCutoffDate('free', clock).toISOString()).toBe('2026-03-08T04:30:00.000Z')
    expect(getExpirationCutoffDate('plus', clock).toISOString()).toBe('2025-12-09T04:30:00.000Z')
    expect(getExpirationCutoffDate('pro', clock).toISOString()).toBe('2025-03-09T04:30:00.000Z')
    expect(getExpirationCutoffDate('team', clock).toISOString()).toBe('2025-03-09T04:30:00.000Z')
  })

  it('removes storage before expired metadata and leaves failed deletions available for retry', async () => {
    const freeId = '1c9b8375-1596-4572-aaa5-605fcfa5c015'
    const legacyId = '331cc0ec-e28f-4f78-851a-7ddb5c5ce508'
    const calls: string[] = []
    const cutoffChecks = {
      batch_size: 100, free_before: '2026-01-29T04:30:00.000Z', plus_before: '2025-11-01T04:30:00.000Z',
      pro_before: '2025-01-30T04:30:00.000Z', team_before: '2025-01-30T04:30:00.000Z',
    }
    let batch: string
    let storageUnavailable = true
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' || input instanceof URL ? input : input.url
      const url = new URL(raw)
      const body = JSON.parse(String(init?.body))
      if (url.pathname.endsWith('/rebuild_claim_checkpoint_retention')) {
        expect(body).toMatchObject({ ...cutoffChecks, batch: expect.any(String) })
        batch = body.batch
        return Response.json([{ version_id: freeId, entity_id: pageId }, { version_id: legacyId, entity_id: viewer }])
      }
      if (url.pathname.endsWith('/rebuild_complete_checkpoint_retention')) {
        expect(body).toEqual({ batch, removed_versions: [freeId, legacyId] })
        calls.push('delete')
        return Response.json(2)
      }
      if (url.pathname.startsWith('/storage/')) {
        expect(body.prefixes).toEqual([pageId + '/versions/' + freeId + '.bin', viewer + '/versions/' + legacyId + '.bin'])
        calls.push('remove')
        if (storageUnavailable) return Response.json({ message: 'Storage unavailable' }, { status: 503 })
        return Response.json([])
      }
      throw new Error('Unexpected fixture path ' + url.pathname)
    }
    const client = createClient('http://127.0.0.1:3323', 'sb_secret_fixture', {
      global: { fetch: fetcher as typeof fetch }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const prune = () => pruneExpiredCheckpoints(client, new Date('2026-01-30T04:30:00.000Z'))
    expect(await prune()).toEqual({ pruned: 0, failures: 2, deferred: false })
    expect(calls).toEqual(['remove'])
    storageUnavailable = false
    expect(await prune()).toEqual({ pruned: 2, failures: 0, deferred: false })
    expect(calls).toEqual(['remove', 'remove', 'delete'])
  })
})

class BrowserSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols, { origin })
  }
}

async function peer(url: string, subject: string, role: 'editor' | 'viewer', doc = new Y.Doc(), Socket = BrowserSocket as unknown as typeof globalThis.WebSocket) {
  const provider = new WebsocketProvider(url, pageId, doc, {
    protocols: [syncProtocol, issueSyncTicket(secret, { pageId, subject, role })],
    WebSocketPolyfill: Socket,
    disableBc: true,
  })
  cleanup.push(() => { provider.destroy(); doc.destroy() })
  await vi.waitFor(() => expect(provider.synced).toBe(true), { timeout: 5000 })
  return provider
}

function testHub(dir: string, persist: (pageId: string, doc: Y.Doc) => Promise<void>, load: () => Promise<Uint8Array | null>) {
  return createSyncHub({
    origin, secret, wal: encryptedWal(dir, snapshotCipher(secret)), load, persist,
    authorize: async ticket => ticket.subject === owner ? 'write' : 'read',
  })
}

async function listen(hub: ReturnType<typeof createSyncHub>) {
  await new Promise<void>(resolve => hub.server.listen(0, '127.0.0.1', resolve))
  return 'ws://127.0.0.1:' + (hub.server.address() as AddressInfo).port
}

describe('collaboration relay', () => {
  it('releases the image reservation when an image is removed before the next snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lekhan-sync-media-'))
    cleanup.push(() => rm(dir, { force: true, recursive: true }))
    const reserveImages = vi.fn(async () => true)
    const recordImages = vi.fn(async () => undefined)
    const persist = vi.fn(async () => undefined)
    const hub = createSyncHub({ origin, secret, wal: encryptedWal(dir, snapshotCipher(secret)), load: async () => null,
      persist, authorize: async ticket => ticket.subject === owner ? 'write' : 'read', reserveImages, recordImages,
    })
    let closed = false
    cleanup.push(async () => { if (!closed) await hub.close() })
    const url = await listen(hub)
    const writer = await peer(url, owner, 'editor')
    const reader = await peer(url, viewer, 'viewer')
    const image = '![Scan](data:image/png;base64,AAAA)'
    const source = writer.doc.getText('source')
    source.insert(0, image)
    await vi.waitFor(() => expect(reader.doc.getText('source').toString()).toBe(image))
    expect(reserveImages).toHaveBeenCalledExactlyOnceWith(pageId, 3)
    source.delete(0, source.length)
    await vi.waitFor(() => expect(reader.doc.getText('source').toString()).toBe(''))
    writer.disconnect()
    reader.disconnect()
    closed = true
    expect(await hub.close()).toBe(true)
    expect(persist).toHaveBeenCalledOnce()
    expect(recordImages.mock.calls).toEqual([[pageId, 0], [pageId, 0]])
  })

  it('discards an interrupted chunk transfer while other editors continue writing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lekhan-sync-interrupted-'))
    cleanup.push(() => rm(dir, { force: true, recursive: true }))
    const wal = encryptedWal(dir, snapshotCipher(secret))
    const append = vi.spyOn(wal, 'append')
    const hub = createSyncHub({
      origin, secret, wal, load: async () => null, persist: async () => undefined,
      authorize: async ticket => ticket.subject === owner ? 'write' : 'read',
    })
    cleanup.push(() => hub.close())
    const url = await listen(hub)
    const reader = await peer(url, viewer, 'viewer')
    const writer = await peer(url, owner, 'editor')
    const socket = new BrowserSocket(url + '/' + pageId, [syncProtocol, issueSyncTicket(secret, { pageId, subject: owner, role: 'editor' })])
    cleanup.push(() => socket.terminate())
    await new Promise<void>((resolve, reject) => socket.once('open', resolve).once('error', reject))
    const closed = new Promise<number>(resolve => socket.once('close', resolve))
    const firstChunk = Buffer.alloc(syncChunkHeaderBytes + syncChunkBytes)
    firstChunk[0] = syncChunkMessage
    firstChunk.writeUInt32BE(maxSyncFrameBytes + syncChunkBytes, 1)
    socket.send(firstChunk)
    socket.send(Buffer.of(3))
    expect(await closed).toBe(1008)
    expect(append).not.toHaveBeenCalled()

    writer.doc.getText('source').insert(0, 'The interrupted transfer never entered this page.')
    await vi.waitFor(() => expect(reader.doc.getText('source').toString()).toBe(writer.doc.getText('source').toString()))
    expect(append).toHaveBeenCalledOnce()
  })

  it('writes full-size paid images from offline sync to the encrypted WAL and replays them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lekhan-sync-large-image-'))
    cleanup.push(() => rm(dir, { force: true, recursive: true }))
    const wal = encryptedWal(dir, snapshotCipher(secret))
    const append = vi.spyOn(wal, 'append')
    const hubOptions = {
      origin, secret, wal, load: async () => null,
      persist: async () => { throw new Error('Storage temporarily unavailable') },
      authorize: async (ticket: { subject: string }) => ticket.subject === owner ? 'write' as const : 'read' as const,
      imagePolicy: async () => 'paid' as const,
    }
    const hub = createSyncHub(hubOptions)
    let stopped = false
    cleanup.push(async () => { if (!stopped) await hub.close() })
    const url = await listen(hub)
    const reader = await peer(url, viewer, 'viewer')
    const doc = new Y.Doc()
    const text = doc.getText('source')
    const raster = 'data:image/png;base64,' + Buffer.alloc(PAID_IMAGE_BYTES, 126).toString('base64')
    const draft = '![Scan](' + raster + ')'
    doc.getMap('lekhan').set('mode', 'source')
    text.insert(0, draft)
    const Socket = chunkedSocket(BrowserSocket as unknown as typeof globalThis.WebSocket, true)
    const writer = await peer(url, owner, 'editor', doc, Socket)
    const digest = (value: string) => createHash('sha256').update(value).digest('hex')
    const expected = digest(draft)
    await vi.waitFor(() => expect(reader.doc.getText('source').length).toBe(draft.length), { timeout: 4000 })
    expect(digest(reader.doc.getText('source').toString())).toBe(expected)
    expect(append).toHaveBeenCalledOnce()
    expect(append.mock.calls[0][1].byteLength).toBeGreaterThan(maxSyncFrameBytes)
    const file = await readFile(join(dir, pageId + '.wal'))
    expect(file.includes('data:image/png')).toBe(false)

    const invalid = new Promise<number | undefined>(resolve => writer.once('connection-close', event => resolve(event?.code)))
    const oversized = 'data:image/png;base64,' + Buffer.alloc(PAID_IMAGE_BYTES + 1, 127).toString('base64')
    text.insert(text.length, '\n\n![Over limit](' + oversized + ')')
    expect(await invalid).toBe(imageLimitCloseCode)
    expect(append).toHaveBeenCalledOnce()
    expect(reader.wsconnected).toBe(true)

    writer.disconnect()
    reader.disconnect()
    stopped = true
    expect(await hub.close()).toBe(false)
    const restarted = createSyncHub({ ...hubOptions, persist: async () => undefined })
    cleanup.push(() => restarted.close())
    const fresh = await peer(await listen(restarted), viewer, 'viewer')
    expect(digest(fresh.doc.getText('source').toString())).toBe(expected)
  }, 20_000)

  it('rejects new over-limit images before publication and keeps the room available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lekhan-sync-images-'))
    cleanup.push(() => rm(dir, { force: true, recursive: true }))
    const legacy = 'data:image/png;base64,AAAA'
    const webp = 'data:image/webp;base64,UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoBAAEAAUAmJZACdLoAA5gA/vQYt8VvqBnIP+Aunui8QAAA'
    function image(source: string) {
      const node = new Y.XmlElement('image')
      node.setAttribute('src', source)
      return node
    }
    const seed = new Y.Doc()
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.push([image(legacy)])
    seed.getXmlFragment('default').push([paragraph])
    let durable = Y.encodeStateAsUpdate(seed)
    seed.destroy()
    const wal = encryptedWal(dir, snapshotCipher(secret))
    const append = vi.spyOn(wal, 'append')
    const policy = vi.fn(async () => 'free' as const)
    const hub = createSyncHub({
      origin, secret, wal, load: async () => durable,
      persist: async (_id, doc) => { durable = Y.encodeStateAsUpdate(doc) },
      authorize: async ticket => ticket.subject === owner ? 'write' : 'read',
      imagePolicy: policy,
    })
    cleanup.push(() => hub.close())
    const url = await listen(hub)
    const reader = await peer(url, viewer, 'viewer')
    const doc = new Y.Doc()
    const writer = new WebsocketProvider(url, pageId, doc, {
      protocols: [syncProtocol, issueSyncTicket(secret, { pageId, subject: owner, role: 'editor' })],
      WebSocketPolyfill: BrowserSocket as unknown as typeof WebSocket & typeof globalThis.WebSocket,
      disableBc: true,
      shouldReconnect: () => false,
    })
    cleanup.push(() => { writer.destroy(); doc.destroy() })
    await vi.waitFor(() => expect(writer.synced).toBe(true))
    const ownParagraph = () => doc.getXmlFragment('default').get(0) as Y.XmlElement
    const sharedParagraph = () => reader.doc.getXmlFragment('default').get(0) as Y.XmlElement
    ;(ownParagraph().get(0) as Y.XmlElement).setAttribute('alt', 'Existing image caption')
    await vi.waitFor(() => expect(sharedParagraph().get(0).toString()).toContain('Existing image caption'))
    expect(policy).not.toHaveBeenCalled()

    ownParagraph().push([image(webp)])
    await vi.waitFor(() => expect(sharedParagraph().length).toBe(2))
    expect(policy).toHaveBeenCalledOnce()
    const count = append.mock.calls.length
    const rejection = new Promise<number | undefined>(resolve => writer.once('connection-close', event => resolve(event?.code)))
    ownParagraph().push([image(legacy)])
    expect(await rejection).toBe(imageLimitCloseCode)
    expect(append).toHaveBeenCalledTimes(count)
    expect(reader.wsconnected).toBe(true)
    expect(sharedParagraph().length).toBe(2)

    ownParagraph().delete(2, 1)
    doc.getText('source').insert(0, 'Writing after recovery')
    writer.connect()
    await vi.waitFor(() => expect(reader.doc.getText('source').toString()).toBe('Writing after recovery'))
    expect(sharedParagraph().length).toBe(2)

    const source = doc.getText('source')
    const partial = '\n\n![Split image](data:ima'
    source.insert(source.length, partial)
    await vi.waitFor(() => expect(reader.doc.getText('source').toString()).toContain('data:ima'))
    const splitRejection = new Promise<number | undefined>(resolve => writer.once('connection-close', event => resolve(event?.code)))
    source.insert(source.length, 'ge/png;base64,AAAA)')
    expect(await splitRejection).toBe(imageLimitCloseCode)
    expect(reader.doc.getText('source').toString()).toBe('Writing after recovery' + partial)
    expect(reader.wsconnected).toBe(true)
  })

  it('returns an upgrade reason when a verified collaborator cannot be admitted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lekhan-sync-capacity-'))
    cleanup.push(() => rm(dir, { force: true, recursive: true }))
    const load = vi.fn(async () => null)
    const hub = createSyncHub({
      origin, secret, wal: encryptedWal(dir, snapshotCipher(secret)), load,
      persist: async () => undefined, authorize: async () => 'limit',
    })
    cleanup.push(() => hub.close())
    const url = await listen(hub)
    const ticket = issueSyncTicket(secret, { pageId, subject: viewer, role: 'viewer' })
    const rejection = await new Promise((resolve, reject) => {
      get(url.replace('ws:', 'http:') + '/' + pageId, {
        headers: { Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket',
          'Sec-WebSocket-Protocol': syncProtocol + ', ' + ticket },
      }, response => {
        response.resume()
        resolve({ status: response.statusCode, reason: response.headers['x-reason'] })
      }).on('error', reject)
    })
    expect(rejection).toEqual({ status: 403, reason: 'Upgrade Required' })
    expect(load).not.toHaveBeenCalled()
  })

  it('hydrates before sync, merges offline updates, and never accepts viewer writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lekhan-sync-room-'))
    cleanup.push(() => rm(dir, { force: true, recursive: true }))
    const initial = new Y.Doc()
    initial.getText('source').insert(0, 'Seed')
    const snapshot = Y.encodeStateAsUpdate(initial)
    initial.destroy()
    let durable: Uint8Array | undefined
    const hub = testHub(dir, async (_id, doc) => { durable = Y.encodeStateAsUpdate(doc) }, async () => snapshot)
    cleanup.push(() => hub.close())
    const url = await listen(hub)
    const first = await peer(url, owner, 'editor')
    const reader = await peer(url, viewer, 'viewer')
    const second = await peer(url, owner, 'editor')
    expect(first.doc.getText('source').toString()).toBe('Seed')

    second.disconnect()
    first.doc.getText('source').insert(0, 'Left ')
    second.doc.getText('source').insert(4, ' right')
    reader.doc.getText('source').insert(0, 'Reader-only ')
    second.connect()
    await vi.waitFor(() => {
      expect(first.doc.getText('source').toString()).toBe('Left Seed right')
      expect(second.doc.getText('source').toString()).toBe('Left Seed right')
    })
    first.awareness.setLocalStateField('user', { name: 'Owner' })
    reader.awareness.setLocalStateField('user', { name: 'Viewer' })
    await vi.waitFor(() => expect(second.awareness.getStates().size).toBeGreaterThanOrEqual(3))
    expect(first.wsconnected && reader.wsconnected && second.wsconnected).toBe(true)

    await vi.waitFor(() => expect(durable).toBeDefined(), { timeout: 4500 })
    const saved = new Y.Doc()
    try {
      Y.applyUpdate(saved, durable!)
      expect(saved.getText('source').toString()).toBe('Left Seed right')
    } finally { saved.destroy() }
  })

  it('replays acknowledged edits after a relay restart when snapshot storage was unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lekhan-sync-restart-'))
    cleanup.push(() => rm(dir, { force: true, recursive: true }))
    const failing = testHub(dir, async () => { throw new Error('storage unavailable') }, async () => null)
    await listen(failing)
    cleanup.push(() => { if (failing.server.listening) return failing.close() })
    const url = 'ws://127.0.0.1:' + (failing.server.address() as AddressInfo).port
    const writer = await peer(url, owner, 'editor')
    const witness = await peer(url, viewer, 'viewer')
    writer.doc.getText('source').insert(0, 'Recovered after restart.')
    await vi.waitFor(() => expect(witness.doc.getText('source').toString()).toBe('Recovered after restart.'))
    writer.disconnect()
    witness.disconnect()
    expect(await failing.close()).toBe(false)

    const recovered = testHub(dir, async () => {}, async () => null)
    cleanup.push(() => recovered.close())
    const restored = await peer(await listen(recovered), owner, 'editor')
    expect(restored.doc.getText('source').toString()).toBe('Recovered after restart.')
  })
})
