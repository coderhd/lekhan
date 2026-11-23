import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uuidPattern } from '../../lib/cloud/graph.ts'
import { getExpirationCutoffDate } from '../../lib/tier-limits.ts'

interface Claim {
  version_id: string
  entity_id: string
}

const batchSize = 100
const maxBatches = 20
const maxRunMs = 180_000

function retentionClaims(value: unknown): value is Claim[] {
  return Array.isArray(value) && value.every(row => row && typeof row.version_id === 'string' &&
    typeof row.entity_id === 'string' && uuidPattern.test(row.version_id) && uuidPattern.test(row.entity_id))
}

export async function pruneExpiredCheckpoints(client: SupabaseClient, now = new Date()) {
  const cutoffs = {
    free_before: getExpirationCutoffDate('free', now).toISOString(),
    plus_before: getExpirationCutoffDate('plus', now).toISOString(),
    pro_before: getExpirationCutoffDate('pro', now).toISOString(),
    team_before: getExpirationCutoffDate('team', now).toISOString(),
  }
  const storage = client.storage.from('documents')
  const deadline = Date.now() + maxRunMs
  let failures = 0
  let pruned = 0

  for (let index = 0; index < maxBatches && Date.now() < deadline; index++) {
    const batch = randomUUID()
    const { data: claims, error } = await client.rpc('rebuild_claim_checkpoint_retention', {
      batch, batch_size: batchSize, ...cutoffs,
    })
    if (error || !retentionClaims(claims)) throw error ?? new Error('Could not claim expired checkpoints.')
    if (!claims.length) return { pruned, failures, deferred: false }

    try {
      const removed = await storage.remove(claims.map(row => row.entity_id + '/versions/' + row.version_id + '.bin'))
      if (removed.error) throw removed.error
      const result = await client.rpc('rebuild_complete_checkpoint_retention', {
        batch, removed_versions: claims.map(row => row.version_id),
      })
      if (result.error || typeof result.data !== 'number') throw new Error('Could not complete checkpoint retention.')
      pruned += result.data
    } catch {
      failures += claims.length
    }
    if (claims.length < batchSize) return { pruned, failures, deferred: false }
  }

  return { pruned, failures, deferred: true }
}
