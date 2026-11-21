import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authConfig } from '../auth/config.ts'
import { EntitlementResolutionError, resolveWorkspaceEntitlement } from '../billing/entitlements.ts'
import { getPlanLimits } from '../tier-limits.ts'
import { pageAccess } from '../cloud/graph.ts'
import type { SyncTicket } from './ticket'

export function createSyncAdmin() {
  const config = authConfig()
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()
  if (!config || !key) return null
  return createClient(config.url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function relayedPageAccess(client: SupabaseClient, ticket: Omit<SyncTicket, 'exp'>, admission: boolean) {
  const page = await pageAccess(client, ticket.pageId, ticket.subject)
  if (!page?.privateAccess) return null

  let plan
  try {
    plan = await resolveWorkspaceEntitlement(page.page.workspace_id, client)
  } catch (failure) {
    if (!(failure instanceof EntitlementResolutionError) || failure.stage !== 'plan-missing') throw failure
  }

  if (admission && page.role !== 'owner') {
    const cap = getPlanLimits(plan?.tier, plan?.seats).maxDistinctCollaborators
    const { data, error } = await client.rpc('record_collaborator_if_capacity', {
      p_document_id: ticket.pageId, p_user_id: ticket.subject, p_max_collaborators: cap,
    })
    if (error || !data || typeof data.allowed !== 'boolean') {
      throw new Error('Could not verify collaborator capacity.', { cause: error })
    }
    if (!data.allowed) return null
  }
  return page.role === 'viewer' || ticket.role === 'viewer' || plan?.relayReadOnly ? 'read' : 'write'
}
