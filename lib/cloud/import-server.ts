import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { snapshotCipher } from '@/server/sync/snapshot'
import { wikiLinks } from '../markdown-references'
import { pageTitle, uuidPattern } from './graph'
import { importPathKey, scanTags, withoutEmbeddedImages } from './graph-index'
import { MAX_IMPORT_BATCH_PAGES, MAX_IMPORT_PAGES, type CloudImportBatch, type CloudImportPage, type CloudImportReceipt } from './import-plan'

function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}

function position(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_IMPORT_PAGES
}

export function validateCloudImport(input: unknown): CloudImportBatch | null {
  if (!record(input) || typeof input.importId !== 'string' || !uuidPattern.test(input.importId) || !position(input.index)
    || !Array.isArray(input.pages) || !input.pages.length || input.pages.length > MAX_IMPORT_BATCH_PAGES) return null
  const pages: CloudImportPage[] = []
  for (const item of input.pages) {
    if (!record(item) || !position(item.ordinal) || (pages.length && item.ordinal !== pages[pages.length - 1].ordinal + 1)
      || !(item.parent === null || position(item.parent) && item.parent < item.ordinal)
      || !pageTitle(item.title) || typeof item.path !== 'string' || !importPathKey(item.path) || Buffer.byteLength(item.path) > 2048
      || /[\u0000-\u001f\u007f]/.test(item.path) || typeof item.markdown !== 'string' || item.markdown.includes('\u0000')
      || (item.properties !== undefined && !record(item.properties))
      || (item.frontmatter !== undefined && (typeof item.frontmatter !== 'string' || item.frontmatter.length > 256_000))) return null
    pages.push(item as unknown as CloudImportPage)
  }
  return { importId: input.importId.toLowerCase(), index: input.index, pages }
}

export function importPageId(workspaceId: string, importId: string, ordinal: number) {
  const hash = createHash('sha256').update(`lekhan:cloud-import:v1:${workspaceId}:${importId}:${ordinal}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function sourceSnapshot(page: CloudImportPage) {
  const doc = new Y.Doc()
  try {
    if (page.markdown) {
      doc.getMap('lekhan').set('mode', 'source')
      doc.getText('source').insert(0, page.markdown)
    }
    if (page.frontmatter) doc.getMap('lekhan').set('frontmatter', page.frontmatter)
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

export async function writeCloudBatch(admin: SupabaseClient, cipher: ReturnType<typeof snapshotCipher>,
  workspaceId: string, ownerId: string, batch: CloudImportBatch) {
  const args = {
    target_workspace: workspaceId, actor: ownerId, attempt: batch.importId, batch_number: batch.index,
    first_page: batch.pages[0].ordinal, digest: createHash('sha256').update(JSON.stringify(batch.pages)).digest('hex'),
  }
  const claim = await admin.rpc('rebuild_import_batch', args)
  if (claim.error) throw claim.error
  if (claim.data) return claim.data as CloudImportReceipt

  const bucket = admin.storage.from('documents')
  const rows = []
  for (const page of batch.pages) {
    const id = importPageId(workspaceId, batch.importId, page.ordinal)
    if (page.markdown || page.frontmatter) {
      const bytes = cipher.seal(sourceSnapshot(page), 'snapshot:' + id, true)
      const { error } = await bucket.upload(id + '/main_state.bin', bytes, { contentType: 'application/octet-stream', upsert: false })
      if (error) {
        if (!/asset already exists|keyalreadyexists|resourcealreadyexists/i.test(error.message)
          && (!('statusCode' in error) || String(error.statusCode) !== '409')) throw error
        const existing = await bucket.exists(id + '/main_state.bin')
        if (existing.error || !existing.data) throw error
      }
    }
    const text = withoutEmbeddedImages(page.markdown).slice(0, 2_000_000)
    const links = [...new Set(wikiLinks(text).map(({ target }) => target.split('#')[0].trim())
      .filter(target => target && Buffer.byteLength(target) <= 2048))].slice(0, 4000)
    rows.push({
      id, parent: page.parent === null ? null : importPageId(workspaceId, batch.importId, page.parent),
      title: page.title.trim(), pathKey: importPathKey(page.path), properties: page.properties ?? {},
      text, links, tags: scanTags(text, page.properties ?? null).map(tag => ({ tag })),
    })
  }
  const { data, error } = await admin.rpc('rebuild_import_batch', { ...args, rows_to_import: rows })
  if (error) throw error
  if (!data) throw new Error('Import did not return a receipt.')
  return data as CloudImportReceipt
}
