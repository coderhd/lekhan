import type { SupabaseClient } from '@supabase/supabase-js'

export interface CloudSearchResult {
  id: string
  title: string
  context: string | null
}

interface RecentPage extends Pick<CloudSearchResult, 'id' | 'title'> {
  updated_at: string
}

interface RankedPage extends CloudSearchResult {
  surface: 'title' | 'tag' | 'link' | 'content'
}

export async function visibleCloudSearchCopies(client: SupabaseClient, subject: string, ids: string[]) {
  const [owned, shared] = await Promise.all([
    client.from('pages').select('id').in('id', ids).eq('owner_id', subject).returns<{ id: string }[]>(),
    client.from('pages').select('id,page_members!inner(user_id)').in('id', ids).eq('page_members.user_id', subject).returns<{ id: string }[]>(),
  ])
  if (owned.error) throw owned.error
  if (shared.error) throw shared.error
  return [...new Set([...owned.data, ...shared.data].map(({ id }) => id))]
}

export async function findCloudPages(client: SupabaseClient, subject: string, rawQuery: string) {
  const query = rawQuery.trim()
  if (query) {
    const term = query.replace(/^#/, '').replace(/^\[\[/, '').replace(/\]\]$/, '').trim() || query
    const { data, error } = await client.rpc('search_pages', { p_query: term, p_limit: 15 })
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Cloud search did not return a page list.')
    return (data as RankedPage[]).map(({ id, title, surface, context }) => ({
      id, title,
      context: context && (surface === 'tag' ? '#' + context : surface === 'link' ? '[[' + context + ']]' : context),
    }))
  }

  const count = 8
  const fields = 'id,title,updated_at'
  const [owned, shared] = await Promise.all([
    client.from('pages').select(fields).eq('owner_id', subject)
      .order('updated_at', { ascending: false }).order('id').limit(count).returns<RecentPage[]>(),
    client.from('pages').select(fields + ',page_members!inner(user_id)').eq('page_members.user_id', subject)
      .order('updated_at', { ascending: false }).order('id').limit(count).returns<RecentPage[]>(),
  ])
  if (owned.error) throw owned.error
  if (shared.error) throw shared.error
  return [...new Map([...owned.data, ...shared.data].map(page => [page.id, page])).values()]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id))
    .slice(0, count).map(({ id, title }) => ({ id, title, context: null }))
}
