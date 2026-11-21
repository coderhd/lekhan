import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { MarkdownManager } from '@tiptap/markdown'
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { writingExtensions } from '@/components/editor/writing-extensions'
import { createServerAdmin } from '@/lib/auth/admin'
import { configuredSnapshotCipher } from '@/server/sync/snapshot'
import { cloudSnapshots } from '@/server/sync/supabase'
import { toTitleKey } from './graph-index'
import { uuidPattern } from './graph'

interface PublicPage {
  id: string
  title: string
  is_public: boolean
}

type LinkedPage = { to_title: string; target: PublicPage | null }
const publicFields = 'id,title,is_public'
const markdown = new MarkdownManager({ extensions: writingExtensions })

export async function getPublicPage(client: SupabaseClient, id: string) {
  if (!uuidPattern.test(id)) return null
  const { data, error } = await client.from('pages').select(publicFields).eq('id', id).eq('is_public', true).maybeSingle<PublicPage>()
  if (error) throw error
  return data?.is_public === true ? data : null
}

export async function readPublicContent(client: SupabaseClient, page: PublicPage) {
  const admin = createServerAdmin()
  const cipher = configuredSnapshotCipher()
  if (!admin || !cipher) throw new Error('Public reading is unavailable.')
  const [snapshot, linked, children] = await Promise.all([
    cloudSnapshots(admin, cipher).load(page.id),
    admin.from('page_links').select('to_title,target:pages!page_links_to_page_id_fkey(' + publicFields + ')')
      .eq('from_page_id', page.id).limit(400).returns<LinkedPage[]>(),
    client.from('pages').select(publicFields).eq('parent_id', page.id).eq('is_public', true)
      .order('title').limit(50).returns<PublicPage[]>(),
  ])

  let source = ''
  if (snapshot) {
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, snapshot)
      source = doc.getMap('lekhan').get('mode') === 'source'
        ? doc.getText('source').toString()
        : markdown.serialize(yDocToProsemirrorJSON(doc, 'default'))
    } finally {
      doc.destroy()
    }
  }

  const targets = new Map<string, string>()
  for (const { to_title, target } of linked.data ?? []) {
    if (target?.is_public && uuidPattern.test(target.id)) targets.set(toTitleKey(to_title), target.id)
  }
  return { source, targets, children: (children.data ?? []).filter(child => child.is_public && uuidPattern.test(child.id)) }
}
