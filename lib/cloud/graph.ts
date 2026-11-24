import type { SupabaseClient } from '@supabase/supabase-js'
import type { PageChoice } from '../types'

export type PageRole = 'owner' | 'editor' | 'viewer'

export interface CloudPage {
  id: string
  workspace_id: string
  parent_id: string | null
  owner_id: string
  title: string
  properties: Record<string, unknown> | null
  is_public: boolean
  updated_at: string
}

export const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const fields = 'id,workspace_id,parent_id,owner_id,title,properties,is_public,updated_at'
const linkFields = 'id,title'
type LinkPage = Pick<CloudPage, 'id' | 'title'>
const batchSize = 24

export function pageTitle(raw: unknown) {
  if (typeof raw !== 'string') return null
  const title = raw.trim()
  if (!title || title.length > 160 || /[\u0000-\u001f\u007f]/u.test(title)) return null
  return title
}

export function resolvePageRole(
  page: Pick<CloudPage, 'owner_id' | 'is_public'>,
  subject: string | null,
  role: unknown,
): PageRole | null {
  if (subject && subject === page.owner_id) return 'owner'
  if (subject && (role === 'editor' || role === 'viewer')) return role
  return page.is_public ? 'viewer' : null
}

export async function pageAccess(client: SupabaseClient, id: string, subject: string | null) {
  if (!uuidPattern.test(id)) return null
  const { data, error } = await client.from('pages').select(fields).eq('id', id).maybeSingle<CloudPage>()
  if (error) throw new Error('Could not check page access.', { cause: error })
  if (!data) return null

  let membership: unknown
  if (subject && subject !== data.owner_id) {
    const { data: member, error: membershipError } = await client.from('page_members')
      .select('role').eq('page_id', id).eq('user_id', subject).maybeSingle()
    if (membershipError) throw new Error('Could not check page membership.', { cause: membershipError })
    membership = member?.role
  }
  const role = resolvePageRole(data, subject, membership)
  return role ? { page: data, role, privateAccess: !!subject && (subject === data.owner_id || membership === 'editor' || membership === 'viewer') } : null
}

export async function listCloudPages(client: SupabaseClient, subject: string, shared: boolean, after?: string) {
  let query = shared ? client.from('pages').select(fields + ',page_members!inner(user_id)').eq('page_members.user_id', subject)
    : client.from('pages').select(fields).eq('owner_id', subject)
  if (after && uuidPattern.test(after)) query = query.gt('id', after)

  const { data, error } = await query.order('id').limit(batchSize + 1).returns<CloudPage[]>()
  if (error) throw new Error('Could not load cloud pages.', { cause: error })
  const pages = data.slice(0, batchSize)
  return { pages, next: data.length > batchSize ? pages.at(-1)?.id : undefined }
}

export async function listCloudChildren(client: SupabaseClient, parentId: string, after?: string) {
  let query = client.from('pages').select(linkFields).eq('parent_id', parentId)
  if (after && uuidPattern.test(after)) query = query.gt('id', after)
  const { data, error } = await query.order('id').limit(batchSize + 1).returns<LinkPage[]>()
  if (error) throw error
  const pages = data.slice(0, batchSize)
  return { pages, next: data.length > batchSize ? pages.at(-1)?.id : undefined }
}

export async function listCloudLinkChoices(client: SupabaseClient, subject: string, source: Pick<CloudPage, 'id' | 'workspace_id'>): Promise<PageChoice[]> {
  const [owned, shared] = await Promise.all([
    client.from('pages').select(linkFields).eq('workspace_id', source.workspace_id).eq('owner_id', subject).neq('id', source.id)
      .order('updated_at', { ascending: false }).order('id').limit(batchSize).returns<LinkPage[]>(),
    client.from('pages').select(linkFields + ',page_members!inner(user_id)').eq('workspace_id', source.workspace_id)
      .eq('page_members.user_id', subject).neq('id', source.id)
      .order('updated_at', { ascending: false }).order('id').limit(batchSize).returns<LinkPage[]>(),
  ])
  const pages = new Map([...(owned.data ?? []), ...(shared.data ?? [])].map(page => [page.id, page]))
  if (!pages.size) return []
  const paths = await client.rpc('rebuild_page_link_paths', { target_pages: [...pages.keys()] })
    .overrideTypes<{ id: string; path: string }[], { merge: false }>()
  const byId = new Map((Array.isArray(paths.data) ? paths.data : []).map(({ id, path }) => [id, path]))
  return [...pages.values()].map(({ id, title }) => ({ id, title, path: byId.get(id) ?? title }))
}

export async function listCloudBacklinks(client: SupabaseClient, pageId: string, after?: string) {
  const { data, error } = await client.rpc('rebuild_page_backlinks', {
    target_page: pageId, after_page: after && uuidPattern.test(after) ? after : null,
  }).overrideTypes<LinkPage[], { merge: false }>()
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Could not load backlinks.')
  const pages = data.slice(0, batchSize)
  return { pages, next: data.length > batchSize ? pages.at(-1)?.id : undefined }
}

export async function ensureCloudWorkspace(client: SupabaseClient, subject: string): Promise<{ id: string; created: boolean }> {
  async function findWorkspace() {
    const { data, error } = await client.from('workspaces').select('id').eq('owner_id', subject).maybeSingle()
    if (error) throw new Error('Could not find your cloud workspace.', { cause: error })
    return data?.id as string | undefined
  }
  const workspace = await findWorkspace()
  if (workspace) return { id: workspace, created: false }

  const { data, error } = await client.from('workspaces').insert({ owner_id: subject }).select('id').single()
  if (!error) return { id: data.id, created: true }
  if (error.code === '23505') {
    const concurrent = await findWorkspace()
    if (concurrent) return { id: concurrent, created: false }
  }
  throw new Error('Could not create your cloud workspace.', { cause: error })
}

export async function createCloudPage(client: SupabaseClient, subject: string, title: string, parentId?: string) {
  const { id: workspaceId, created } = await ensureCloudWorkspace(client, subject)
  if (parentId) {
    const parent = await pageAccess(client, parentId, subject)
    if (!parent || parent.role !== 'owner' || parent.page.workspace_id !== workspaceId) {
      throw new Error('Choose a parent in your cloud workspace.')
    }
  }
  const { data, error } = await client.from('pages').insert({
    workspace_id: workspaceId, owner_id: subject, title, parent_id: parentId || null,
  }).select('id').single()
  if (error) throw new Error('Could not create the cloud page.', { cause: error })
  return { id: data.id as string, workspaceCreated: created }
}
