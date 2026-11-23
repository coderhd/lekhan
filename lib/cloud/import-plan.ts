import type { VaultImportPlan } from '../vault-import'
import type { CloudImagePolicy } from './image-policy'
import { applyVaultImport, pageChoices } from '../workspace'

export const MAX_IMPORT_BATCH_BYTES = 48 * 1024 * 1024
export const MAX_SMALL_IMPORT_BATCH_BYTES = 4 * 1024 * 1024
export const MAX_IMPORT_BATCH_PAGES = 50
export const MAX_IMPORT_PAGES = 2_000

export interface CloudImportPage {
  ordinal: number
  parent: number | null
  title: string
  path: string
  markdown: string
  frontmatter?: string
  properties?: Record<string, unknown>
}

export interface CloudImportBatch {
  importId: string
  index: number
  imagePolicy?: CloudImagePolicy | null
  pages: CloudImportPage[]
  localMirror?: LocalMirrorPlacement
}

export interface LocalMirrorPlacement {
  notebook: string
  key: string
  parent: string | null
  known: { key: string; parent: string | null; page: string }[]
}

export interface CloudImportReceipt {
  pages: { id: string; title: string }[]
  importedCount: number
  replayed: boolean
}

export function cloudImportPlan(vault: VaultImportPlan) {
  const { workspace, report } = applyVaultImport({ revision: 0, pages: [], activePageId: null }, vault)
  const positions = new Map(workspace.pages.map(({ id }, index) => [id, index]))
  const paths = pageChoices(workspace.pages)
  const pages: CloudImportPage[] = workspace.pages.map((page, ordinal) => ({
    ordinal,
    parent: page.parentId ? positions.get(page.parentId)! : null,
    title: page.title,
    path: paths[ordinal].path,
    markdown: page.markdown,
    ...(page.properties ? { properties: page.properties } : {}),
    ...(page.frontmatter ? { frontmatter: page.frontmatter } : {}),
  }))

  const hex = vault.fingerprint.slice(0, 32)
  const importId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
  const encoder = new TextEncoder()
  const batches: CloudImportBatch[] = []
  let batch: CloudImportBatch = { importId, index: 0, pages: [] }
  let bytes = 100
  for (const page of pages) {
    const size = encoder.encode(JSON.stringify(page)).byteLength + 1
    if (size + 100 > MAX_IMPORT_BATCH_BYTES) throw new Error(`“${page.title}” is too large to send in a single upload.`)
    if (batch.pages.length && (bytes + size > MAX_SMALL_IMPORT_BATCH_BYTES || batch.pages.length >= MAX_IMPORT_BATCH_PAGES)) {
      batches.push(batch)
      batch = { importId, index: batches.length, pages: [] }
      bytes = 100
    }
    batch.pages.push(page)
    bytes += size
  }
  if (batch.pages.length) batches.push(batch)
  return { report, batches, firstNote: positions.get(workspace.activePageId ?? '') ?? 0 }
}
