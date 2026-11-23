import type { SupabaseClient } from '@supabase/supabase-js'

interface PageImages { page: string; bytes: number }

export async function reservePageImages(client: SupabaseClient, requested: PageImages[], workspace: string | null = null) {
  const result = await client.rpc('rebuild_reserve_page_images', {
    target_workspace: workspace, requested, importing: workspace !== null,
  })
  if (result.error) throw result.error
  if (typeof result.data !== 'boolean') throw new Error('Could not verify workspace storage.')
  return result.data
}

export async function recordPageImages(client: SupabaseClient, pageId: string, bytes: number) {
  const result = await client.rpc('rebuild_record_page_images', { target_page: pageId, observed_bytes: bytes })
  if (result.error) throw result.error
}
