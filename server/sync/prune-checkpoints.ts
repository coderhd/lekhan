import type { SupabaseClient } from '@supabase/supabase-js'
import { workspaceEntitlementOrFree } from '../../lib/billing/entitlements.ts'
import { getExpirationCutoffDate } from '../../lib/tier-limits.ts'

interface StoredVersion {
  id: string
  page_id: string | null
  document_id: string | null
  created_at: string
}

async function versionWorkspace(client: SupabaseClient, version: StoredVersion) {
  if (version.page_id) {
    const { data, error } = await client.from('pages').select('workspace_id').eq('id', version.page_id).maybeSingle()
    if (error) throw error
    return data?.workspace_id as string | undefined
  }
  if (!version.document_id) return undefined
  const { data: doc, error: docError } = await client.from('documents').select('owner_id').eq('id', version.document_id).maybeSingle()
  if (docError) throw docError
  if (!doc) return undefined
  const { data: workspace, error } = await client.from('workspaces').select('id').eq('owner_id', doc.owner_id).maybeSingle()
  if (error) throw error
  return workspace?.id as string | undefined
}

export async function pruneExpiredCheckpoints(client: SupabaseClient, now = new Date()) {
  const earliestExpiry = getExpirationCutoffDate('free', now).toISOString()
  const storage = client.storage.from('documents')
  const batchSize = 100
  let after = ''
  let failures = 0
  let pruned = 0

  while (true) {
    let query = client.from('document_versions').select('id,page_id,document_id,created_at')
      .lt('created_at', earliestExpiry).order('id').limit(batchSize)
    if (after) query = query.gt('id', after)
    const { data: versions, error } = await query.returns<StoredVersion[]>()
    if (error) throw error

    const cutoffs = new Map<string, number>()
    const workspaces = new Map<string, string>()
    for (const version of versions) {
      const entity = version.page_id || version.document_id
      if (!entity) continue
      try {
        const key = (version.page_id ? 'page:' : 'document:') + entity
        const workspace = workspaces.get(key) ?? await versionWorkspace(client, version)
        if (!workspace) continue
        workspaces.set(key, workspace)
        let cutoff = cutoffs.get(workspace)
        if (cutoff === undefined) {
          const plan = await workspaceEntitlementOrFree(workspace, client)
          cutoff = getExpirationCutoffDate(plan?.tier, now).getTime()
          cutoffs.set(workspace, cutoff)
        }
        if (Date.parse(version.created_at) >= cutoff) continue

        const removed = await storage.remove([entity + '/versions/' + version.id + '.bin'])
        if (removed.error) throw removed.error
        const row = await client.from('document_versions').delete().eq('id', version.id).lt('created_at', new Date(cutoff).toISOString())
        if (row.error) throw row.error
        pruned++
      } catch {
        failures++
      }
    }
    if (versions.length < batchSize) return { pruned, failures }
    after = versions[versions.length - 1].id
  }
}
