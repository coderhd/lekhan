import { checkpointName } from '../../lib/cloud/checkpoints.ts'
import { uuidPattern } from '../../lib/cloud/graph.ts'
import type { snapshotCipher } from './snapshot.ts'

export type CheckpointOperation = ({ method: 'GET' } | { method: 'POST'; name: string }) & {
  page: string
  version: string
}
export type CheckpointTransfer = CheckpointOperation & {
  subject: string
  accessToken: string
}

const purpose = 'checkpoint-transfer:v1'
const lifetime = 3 * 60 * 1000
type Cipher = ReturnType<typeof snapshotCipher>

export function sealCheckpointTransfer(cipher: Cipher, transfer: CheckpointTransfer, now = Date.now()) {
  return cipher.seal(Buffer.from(JSON.stringify({ ...transfer, until: now + lifetime })), purpose).toString('base64url')
}

export function openCheckpointTransfer(cipher: Cipher, token: string, now = Date.now()): (CheckpointTransfer & { until: number }) | null {
  if (!token || token.length > 10_240 || !/^[\w-]+$/.test(token)) return null
  try {
    const data = JSON.parse(Buffer.from(cipher.open(Buffer.from(token, 'base64url'), purpose, false)).toString('utf8'))
    if (!Number.isSafeInteger(data.until) || data.until <= now || data.until > now + lifetime ||
      typeof data.page !== 'string' || !uuidPattern.test(data.page) ||
      typeof data.version !== 'string' || !uuidPattern.test(data.version) ||
      typeof data.subject !== 'string' || !uuidPattern.test(data.subject) ||
      typeof data.accessToken !== 'string' || !data.accessToken) return null
    if (data.method === 'GET') return data
    if (data.method === 'POST' && typeof data.name === 'string' && checkpointName(data.name) === data.name) return data
    return null
  } catch {
    return null
  }
}
