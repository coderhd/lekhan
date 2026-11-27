import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { attachmentPaths, PAID_ATTACHMENT_BYTES } from '../../lib/cloud/attachments.ts'
import { uuidPattern } from '../../lib/cloud/graph.ts'

interface Claim { id: string; page_id: string; byte_count: number }

export async function pruneAttachments(client: SupabaseClient) {
  const batch = randomUUID()
  const { data, error } = await client.rpc('rebuild_claim_attachment_cleanup', { batch })
  if (error || !Array.isArray(data)) throw error ?? new Error('Could not claim attachment cleanup.')
  const removed: string[] = []
  for (const { id, page_id, byte_count } of data as Claim[]) {
    if (!uuidPattern.test(id) || !uuidPattern.test(page_id) || !Number.isSafeInteger(byte_count) || byte_count < 1 || byte_count > PAID_ATTACHMENT_BYTES) continue
    const result = await client.storage.from('documents').remove(attachmentPaths(page_id, id, byte_count))
    if (!result.error) removed.push(id)
  }
  if (removed.length) {
    const result = await client.rpc('rebuild_complete_attachment_cleanup', { batch, removed })
    if (result.error) throw result.error
  }
  return { removed: removed.length, failures: data.length - removed.length }
}
