import type { SupabaseClient } from '@supabase/supabase-js'
import type { JSONContent } from '@tiptap/react'
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { wikiLinks } from '../../lib/markdown-references.ts'
import type { snapshotCipher } from './snapshot.ts'

const maxStoredBytes = 64 * 1024 * 1024
const maxIndexSize = 2_000_000
const toTitleKey = (text: string) => text.trim().replace(/\s+/g, ' ').normalize('NFC').toLowerCase()

export function indexedDocument(doc: Y.Doc) {
  const source = doc.getMap('lekhan').get('mode') === 'source'
  if (source) return doc.getText('source').toString().slice(0, maxIndexSize)

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

function scanTags(raw: string, properties: Record<string, unknown> | null) {
  const propertyTags = properties?.tags
  const input = Array.isArray(propertyTags) ? propertyTags : typeof propertyTags === 'string' ? propertyTags.split(/[\s,]+/) : []
  const body = raw.replace(/^`{3,}[^\n]*\n[\s\S]*?^\x60{3,}[^\n]*$/gm, '').replace(/`[^`\n]+`/g, '')
  const tags = new Set<string>()
  for (const item of input.concat(Array.from(body.matchAll(/(?:^|[\s(,;])#([\p{L}\p{M}\p{N}_/-]+)/gu), match => match[1]))) {
    if (typeof item !== 'string') continue
    const tag = toTitleKey(item).replace(/^#/, '')
    if (/^[\p{L}\p{M}\p{N}_/-]{1,125}$/u.test(tag) && !/^\p{N}+$/u.test(tag)) tags.add(tag)
  }
  return [...tags]
}

async function syncGraph(client: SupabaseClient, pageId: string, text: string) {
  const { data: page, error } = await client.from('pages').select('workspace_id,properties').eq('id', pageId).maybeSingle()
  if (error) throw error
  if (!page) throw new Error('Page was removed before indexing.')
  const links = new Map<string, string>()
  for (const { target } of wikiLinks(text)) {
    const title = target.split('#')[0].trim()
    if (title && title.length <= 160 && !links.has(toTitleKey(title))) links.set(toTitleKey(title), title)
  }
  const exact = new Map<string, string | null>()
  const names = [...links.values()].filter(title => !title.includes('/'))
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
      if (data.size > maxStoredBytes) throw new Error('Stored page exceeds the sync size limit.')
      return cipher.open(new Uint8Array(await data.arrayBuffer()), 'snapshot:' + pageId)
    },
    async persist(pageId: string, doc: Y.Doc) {
      const bytes = Y.encodeStateAsUpdate(doc)
      if (bytes.length > maxStoredBytes) throw new Error('Page exceeds the sync size limit.')
      const encrypted = cipher.seal(bytes, 'snapshot:' + pageId, true)
      const { error } = await bucket.upload(pageId + '/main_state.bin', encrypted, {
        contentType: 'application/octet-stream', upsert: true,
      })
      if (error) throw error
      await syncGraph(client, pageId, indexedDocument(doc))
    },
  }
}
