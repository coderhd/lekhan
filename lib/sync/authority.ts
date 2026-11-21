import type { SupabaseClient } from '@supabase/supabase-js'
import { workspaceEntitlementOrFree } from '../billing/entitlements.ts'
import { getPlanLimits } from '../tier-limits.ts'
import { pageAccess } from '../cloud/graph.ts'
import type { SyncTicket } from './ticket'

export async function relayedPageAccess(client: SupabaseClient, ticket: Omit<SyncTicket, 'exp'>, admission: boolean) {
  const page = await pageAccess(client, ticket.pageId, ticket.subject)
  if (!page?.privateAccess) return null

  const plan = await workspaceEntitlementOrFree(page.page.workspace_id, client)

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
