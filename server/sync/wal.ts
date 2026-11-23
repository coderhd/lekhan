import { mkdir, open, readFile, stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { maxPageUpdateBytes } from '../../lib/sync/wire.ts'
import { snapshotEnvelopeBytes, type snapshotCipher } from './snapshot.ts'

const maxWalBytes = 96 * 1024 * 1024
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export function encryptedWal(directory: string, cipher: ReturnType<typeof snapshotCipher>) {
  function pathFor(pageId: string) {
    if (!uuid.test(pageId)) throw new Error('Invalid page identifier.')
    return join(directory, pageId + '.wal')
  }

  async function size(path: string) {
    try { return (await stat(path)).size } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw failure
    }
  }

  return {
    async needsCompaction(pageId: string, updateBytes: number) {
      return (await size(pathFor(pageId))) + updateBytes + snapshotEnvelopeBytes + 4 > maxWalBytes
    },
    async replay(pageId: string, apply: (update: Uint8Array) => void) {
      const path = pathFor(pageId)
      const length = await size(path)
      if (!length) return
      if (length > maxWalBytes) throw new Error('WAL exceeds the recovery limit.')
      const file = await readFile(path)
      let offset = 0
      while (offset + 4 <= file.length) {
        const chunkLength = file.readUInt32BE(offset)
        if (!chunkLength || chunkLength > maxPageUpdateBytes + snapshotEnvelopeBytes) throw new Error('Invalid WAL record size.')
        if (offset + 4 + chunkLength > file.length) break
        apply(cipher.open(file.subarray(offset + 4, offset + 4 + chunkLength), 'wal:' + pageId, false))
        offset += 4 + chunkLength
      }
      if (offset !== file.length) await truncate(path, offset)
    },
    async append(pageId: string, update: Uint8Array) {
      const path = pathFor(pageId)
      if (!update.length || update.length > maxPageUpdateBytes) throw new Error('WAL record exceeds the write limit.')
      const payload = cipher.seal(update, 'wal:' + pageId)
      const existing = await size(path)
      if (existing + payload.length + 4 > maxWalBytes) throw new Error('The WAL needs compaction before accepting more updates.')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const length = Buffer.alloc(4)
      length.writeUInt32BE(payload.length)
      const handle = await open(path, 'a', 0o600)
      try {
        await handle.writeFile(Buffer.concat([length, payload]))
        await handle.sync()
      } catch (failure) {
        await handle.truncate(existing).catch(() => undefined)
        throw failure
      } finally {
        await handle.close()
      }
    },
    async clear(pageId: string) {
      const path = pathFor(pageId)
      if (!await size(path)) return
      const handle = await open(path, 'r+')
      try {
        await handle.truncate(0)
        await handle.sync()
      } finally {
        await handle.close()
      }
    },
  }
}
