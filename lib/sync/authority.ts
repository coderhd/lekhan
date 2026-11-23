import type { SupabaseClient } from '@supabase/supabase-js'
import { collaboratorCapacity, workspaceEntitlementOrFree } from '../billing/entitlements.ts'
import { pageAccess } from '../cloud/graph.ts'
import type { CloudImagePolicy } from '../cloud/image-policy.ts'
import type { SyncTicket } from './ticket'

export type RelayAccess = 'read' | 'write' | 'limit' | null

export async function relayedPageAuthority(
  client: SupabaseClient, ticket: Omit<SyncTicket, 'exp'>, admission: boolean,
): Promise<{ access: RelayAccess; imagePolicy: CloudImagePolicy }> {
  const page = await pageAccess(client, ticket.pageId, ticket.subject)
  if (!page?.privateAccess) return { access: null, imagePolicy: 'free' }

  const plan = await workspaceEntitlementOrFree(page.page.workspace_id, client)
  const imagePolicy = plan && plan.tier !== 'free' ? 'paid' : 'free'
  let role = page.role

  if (admission && role !== 'owner') {
    const { data, error } = await client.rpc('rebuild_record_page_collaborator', {
      target_page: ticket.pageId, actor: ticket.subject, ...collaboratorCapacity(plan),
    })
    if (error || !['owner', 'editor', 'viewer', 'denied', 'limit'].includes(data)) {
      throw new Error('Could not verify collaborator capacity.', { cause: error })
    }
    if (data === 'limit') return { access: 'limit', imagePolicy }
    if (data === 'denied') return { access: null, imagePolicy }
    role = data
  }
  const access = role === 'viewer' || ticket.role === 'viewer' || plan?.relayReadOnly ? 'read' : 'write'
  return { access, imagePolicy }
}

export async function relayedPageAccess(client: SupabaseClient, ticket: Omit<SyncTicket, 'exp'>, admission: boolean) {
  return (await relayedPageAuthority(client, ticket, admission)).access
}
