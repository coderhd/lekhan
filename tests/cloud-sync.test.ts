import { mkdtemp, rm, readFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { WebSocket } from 'ws'
import { WebsocketProvider } from 'y-websocket'
import { issueSyncTicket, verifySyncTicket } from '../lib/sync/ticket'
import { syncProtocol } from '../lib/sync/wire'
import { createSyncHub } from '../server/sync/hub'
import { snapshotCipher } from '../server/sync/snapshot'
import { encryptedWal } from '../server/sync/wal'

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
})

class BrowserSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols, { origin })
  }
}

async function peer(url: string, subject: string, role: 'editor' | 'viewer', doc = new Y.Doc()) {
  const provider = new WebsocketProvider(url, pageId, doc, {
    protocols: [syncProtocol, issueSyncTicket(secret, { pageId, subject, role })],
    WebSocketPolyfill: BrowserSocket as unknown as typeof WebSocket & typeof globalThis.WebSocket,
    disableBc: true,
  })
  cleanup.push(() => { provider.destroy(); doc.destroy() })
  await vi.waitFor(() => expect(provider.synced).toBe(true))
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
