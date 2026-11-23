import type { SupabaseClient } from '@supabase/supabase-js'
import { collaboratorCapacity, workspaceEntitlementOrFree } from '@/lib/billing/entitlements'

export type SharedRole = 'viewer' | 'editor'

export interface InvitationDetails {
  page_id: string
  title: string
  role: SharedRole
  status: 'pending' | 'accepted' | 'declined'
}

export function sharingRole(raw: FormDataEntryValue | null): SharedRole | null {
  return raw === 'viewer' || raw === 'editor' ? raw : null
}

export function invitationEmail(raw: FormDataEntryValue | null) {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export async function inspectInvitation(admin: SupabaseClient, token: string, subject: string) {
  const { data, error } = await admin.rpc('rebuild_page_invitation', {
    invitation_token: token, actor: subject, operation: 'inspect',
  }).maybeSingle<InvitationDetails>()
  if (error) throw error
  return data
}

export async function readCollaboratorCapacity(admin: SupabaseClient, workspaceId: string) {
  return collaboratorCapacity(await workspaceEntitlementOrFree(workspaceId, admin))
}
