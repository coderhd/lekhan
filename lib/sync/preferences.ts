import type { SupabaseClient } from '@supabase/supabase-js'

export type PageSyncPreference = 'personal' | 'paused' | 'paid' | 'shared'

export function pageSyncPreference(value: unknown): value is PageSyncPreference {
  return value === 'personal' || value === 'paused' || value === 'paid' || value === 'shared'
}

export async function readPageSyncPreference(client: SupabaseClient, pageId: string) {
  const result = await client.rpc('rebuild_page_sync_preference', { target_page: pageId })
  if (result.error || !pageSyncPreference(result.data)) throw result.error ?? new Error('Could not verify page sync preference.')
  return result.data
}

export async function setPageSyncPreference(client: SupabaseClient, pageId: string, actor: string, enabled: boolean) {
  const result = await client.rpc('rebuild_set_page_sync', { target_page: pageId, actor, enabled })
  if (result.error) throw result.error
  if (result.data === 'denied' || pageSyncPreference(result.data)) return result.data
  throw new Error('Could not update page sync preference.')
}
