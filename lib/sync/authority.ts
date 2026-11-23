import type { SupabaseClient } from '@supabase/supabase-js'
import { collaboratorCapacity, workspaceEntitlementOrFree } from '../billing/entitlements.ts'
import { pageAccess } from '../cloud/graph.ts'
import type { SyncTicket } from './ticket'

export type RelayAccess = 'read' | 'write' | 'limit' | null

export async function relayedPageAccess(
  client: SupabaseClient, ticket: Omit<SyncTicket, 'exp'>, admission: boolean,
): Promise<RelayAccess> {
  const page = await pageAccess(client, ticket.pageId, ticket.subject)
  if (!page?.privateAccess) return null

  const plan = await workspaceEntitlementOrFree(page.page.workspace_id, client)
  let role = page.role

  if (admission && role !== 'owner') {
    const { data, error } = await client.rpc('rebuild_record_page_collaborator', {
      target_page: ticket.pageId, actor: ticket.subject, ...collaboratorCapacity(plan),
    })
    if (error || !['owner', 'editor', 'viewer', 'denied', 'limit'].includes(data)) {
      throw new Error('Could not verify collaborator capacity.', { cause: error })
    }
    if (data === 'limit') return 'limit'
    if (data === 'denied') return null
    role = data
  }
  return role === 'viewer' || ticket.role === 'viewer' || plan?.relayReadOnly ? 'read' : 'write'
}
