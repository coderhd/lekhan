import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const legacy = Buffer.from('LK_ENC_1')
const version = Buffer.from('LK_ENC_2')
const ivSize = 12
const tagSize = 16
const headerSize = version.length + ivSize + tagSize

export function configuredSnapshotCipher() {
  const primary = process.env.LEKHAN_ENCRYPTION_KEY?.trim()
  if (!primary || primary.length < 32) return null
  return snapshotCipher(primary, (process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS ?? '').split(',').map(value => value.trim()).filter(Boolean))
}

export function snapshotCipher(primary: string, previous: string[] = []) {
  if (primary.length < 32) throw new Error('Set a strong LEKHAN_ENCRYPTION_KEY before starting sync.')
  const keys = [primary, ...previous].map(secret => createHash('sha256').update(secret).digest())

  return {
    seal(bytes: Uint8Array, purpose: string, compatibleSnapshot = false) {
      const iv = randomBytes(ivSize)
      const cipher = createCipheriv('aes-256-gcm', keys[0], iv)
      if (!compatibleSnapshot) cipher.setAAD(Buffer.from(purpose))
      const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
      return Buffer.concat([compatibleSnapshot ? legacy : version, iv, cipher.getAuthTag(), encrypted])
    },
    open(bytes: Uint8Array, purpose: string, allowLegacy = true): Uint8Array {
      const data = Buffer.from(bytes)
      const magic = data.subarray(0, version.length)
      const isLegacy = magic.equals(legacy)
      if (!magic.equals(version) && !(allowLegacy && isLegacy)) {
        // Older pages have raw Yjs updates. They are rewritten encrypted the next time they change.
        if (allowLegacy && !magic.subarray(0, 7).equals(version.subarray(0, 7))) return data
        throw new Error('Unsupported snapshot format.')
      }
      if (data.length < headerSize) throw new Error('Truncated encrypted snapshot.')
      const iv = data.subarray(version.length, version.length + ivSize)
      const tag = data.subarray(version.length + ivSize, headerSize)
      for (const key of keys) {
        try {
          const decipher = createDecipheriv('aes-256-gcm', key, iv)
          if (!isLegacy) decipher.setAAD(Buffer.from(purpose))
          decipher.setAuthTag(tag)
          return Buffer.concat([decipher.update(data.subarray(headerSize)), decipher.final()])
        } catch {
          // The envelope has no key identifier. Try the next configured rotation key.
        }
      }
      throw new Error('Snapshot authentication failed.')
    },
  }
}
