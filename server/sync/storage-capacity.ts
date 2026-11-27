import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const defaultCeiling = 1_000_000_000

export class DocumentUploadUnavailable extends Error {
  readonly reason: 'full' | 'busy'

  constructor(reason: 'full' | 'busy') {
    super('Cloud storage is temporarily unavailable.')
    this.reason = reason
  }
}

function documentCeiling() {
  const value = process.env.LEKHAN_DOCUMENTS_STORAGE_LIMIT_BYTES?.trim()
  if (!value) return defaultCeiling
  const limit = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('LEKHAN_DOCUMENTS_STORAGE_LIMIT_BYTES must be a positive byte count.')
  }
  return limit
}

export async function uploadDocumentObject(client: SupabaseClient, path: string, bytes: Uint8Array, upsert: boolean) {
  const lease = randomUUID()
  const reservation = await client.rpc('rebuild_reserve_document_upload', {
    target_path: path, proposed_lease: lease, proposed_bytes: bytes.byteLength,
    ceiling_bytes: documentCeiling(), replace_existing: upsert,
  })
  if (reservation.error) throw reservation.error
  if (reservation.data === 'exists') return 'exists'
  if (reservation.data === 'full' || reservation.data === 'busy') throw new DocumentUploadUnavailable(reservation.data)
  if (reservation.data !== 'reserved') throw new Error('Invalid cloud storage reservation.')

  const bucket = client.storage.from('documents')
  const { error } = await bucket.upload(path, bytes, { contentType: 'application/octet-stream', upsert })
  const status = error && 'statusCode' in error ? Number(error.statusCode) : 0
  // A network error can leave an upload in flight. Its reservation expires
  // automatically, while confirmed writes or refusals can release it now.
  if (!error || (status >= 400 && status < 500 && status !== 408)) {
    await Promise.resolve(client.rpc('rebuild_release_document_upload', { completed_lease: lease })).catch(() => undefined)
  }
  if (!error) return 'uploaded'
  if (!upsert && (status === 409 || /asset already exists|keyalreadyexists|resourcealreadyexists/i.test(error.message))) return 'exists'
  throw error
}
