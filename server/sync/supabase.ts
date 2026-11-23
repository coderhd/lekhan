import type { SupabaseClient } from '@supabase/supabase-js'
import type { JSONContent } from '@tiptap/react'
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { wikiLinks } from '../../lib/markdown-references.ts'
import { scanTags, toTitleKey, withoutEmbeddedImages } from '../../lib/cloud/graph-index.ts'
import { maxPageUpdateBytes } from '../../lib/sync/wire.ts'
import { snapshotEnvelopeBytes, type snapshotCipher } from './snapshot.ts'
import { uploadDocumentObject } from './storage-capacity.ts'

const maxIndexSize = 2_000_000

export function indexedDocument(doc: Y.Doc) {
  const source = doc.getMap('lekhan').get('mode') === 'source'
  if (source) return withoutEmbeddedImages(doc.getText('source').toString()).slice(0, maxIndexSize)

  const json = yDocToProsemirrorJSON(doc, 'default') as JSONContent
  const stack: (JSONContent | string)[] = [json]
  const parts: string[] = []
  let length = 0
  while (stack.length && length < maxIndexSize) {
    const node = stack.pop()
    if (!node) continue
    if (typeof node === 'string') {
      parts.push(node)
      length += node.length
      continue
    }
    if (node.type === 'pageLink' && typeof node.attrs?.target === 'string') {
      stack.push('[[' + node.attrs.target + ']]')
    } else if (node.type === 'codeBlock') {
      // Include code in full-text search, while shielding it from tag/link extraction.
      const body = (node.content ?? []).map(child => child.text ?? '').join('')
      const run = Math.max(2, ...Array.from(body.matchAll(/`+/g), match => match[0].length))
      const fence = '`'.repeat(run + 1)
      stack.push('\n' + fence + '\n' + body + '\n' + fence + '\n')
    } else if (node.text) {
      stack.push(node.text)
    } else {
      if (!['doc', 'paragraph', 'heading', 'blockquote', 'vaultCallout', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem'].includes(node.type ?? '')) continue
      stack.push('\n')
      for (const child of [...(node.content ?? [])].reverse()) stack.push(child)
    }
  }
  return parts.join('').slice(0, maxIndexSize)
}

async function syncGraph(client: SupabaseClient, pageId: string, text: string) {
  const { data: page, error } = await client.from('pages').select('workspace_id,properties').eq('id', pageId).maybeSingle()
  if (error) throw error
  if (!page) throw new Error('Page was removed before indexing.')
  const links = new Map<string, string>()
  for (const { target } of wikiLinks(text)) {
    const title = target.split('#')[0].trim()
    if (title && Buffer.byteLength(title) <= 2048 && !links.has(toTitleKey(title))) links.set(toTitleKey(title), title)
  }
  const exact = new Map<string, string | null>()
  if (links.size) {
    const { data: indexed, error: linkError } = await client.from('page_links').select('to_title,to_page_id')
      .eq('from_page_id', pageId).not('to_page_id', 'is', null).limit(4000)
    if (linkError) throw linkError
    for (const link of indexed) exact.set(toTitleKey(link.to_title), link.to_page_id)
  }
  const names = [...links.values()].filter(title => !title.includes('/') && !exact.has(toTitleKey(title)))
  for (let index = 0; index < names.length; index += 35) {
    const response = await client.from('pages').select('id,title').eq('workspace_id', page.workspace_id).in('title', names.slice(index, index + 35))
    if (response.error) throw response.error
    for (const candidate of response.data) {
      const key = toTitleKey(candidate.title)
      exact.set(key, exact.has(key) ? null : candidate.id)
    }
  }
  const { error: writeError } = await client.rpc('sync_page_graph', {
    p_page_id: pageId, p_workspace_id: page.workspace_id, p_searchable_text: text,
    p_links: [...links].map(([key, title]) => ({ to_title: title, to_page_id: exact.get(key) ?? null })),
    p_tags: scanTags(text, page.properties).map(tag => ({ tag })),
  })
  if (writeError) throw writeError
}

export function cloudSnapshots(client: SupabaseClient, cipher: ReturnType<typeof snapshotCipher>) {
  const bucket = client.storage.from('documents')
  return {
    async load(pageId: string) {
      const { data, error } = await bucket.download(pageId + '/main_state.bin')
      if (error) {
        if ('status' in error && String(error.status) === '404') return null
        if ('statusCode' in error && String(error.statusCode) === '404') return null
        throw error
      }
      if (data.size > maxPageUpdateBytes + snapshotEnvelopeBytes) throw new Error('Stored page exceeds the sync size limit.')
      const bytes = cipher.open(new Uint8Array(await data.arrayBuffer()), 'snapshot:' + pageId)
      if (bytes.length > maxPageUpdateBytes) throw new Error('Stored page exceeds the sync size limit.')
      return bytes
    },
    async persist(pageId: string, doc: Y.Doc) {
      const bytes = Y.encodeStateAsUpdate(doc)
      if (bytes.length > maxPageUpdateBytes) throw new Error('Page exceeds the sync size limit.')
      const encrypted = cipher.seal(bytes, 'snapshot:' + pageId, true)
      if (await uploadDocumentObject(client, pageId + '/main_state.bin', encrypted, true) !== 'uploaded') {
        throw new Error('Could not replace the cloud snapshot.')
      }
      await syncGraph(client, pageId, indexedDocument(doc))
    },
  }
}
