import type { VaultImportPlan } from '../vault-import'
import { attachmentDestination, attachmentReference } from '../local-attachments'
import { mapMarkdownDestinations } from '../markdown-destinations'
import type { LocalAttachment } from '../types'
import { attachmentName, FREE_ATTACHMENT_BYTES, PAID_ATTACHMENT_BYTES } from './attachments'
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

type CloudArchiveFile = LocalAttachment & { ordinal: number }
export type BoundCloudFile = CloudArchiveFile & { sourceId: string; digest: string }

function importUuid(hex: string) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('')
}

export function cloudImportPlan(vault: VaultImportPlan) {
  const { workspace, report } = applyVaultImport({ revision: 0, pages: [], activePageId: null }, vault, { relativeImages: false })
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

  const importId = importUuid(vault.fingerprint)
  const files: CloudArchiveFile[] = workspace.pages.flatMap((page, ordinal) =>
    (page.files ?? []).map(file => ({ ...file, ordinal })))
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
  return { report, batches, files, firstNote: positions.get(workspace.activePageId ?? '') ?? 0 }
}

export async function bindCloudImportFiles<T extends { batches: CloudImportBatch[]; files: CloudArchiveFile[] }>(
  plan: T, account: string | undefined, policy: CloudImagePolicy,
): Promise<Omit<T, 'files'> & { files: BoundCloudFile[] }> {
  if (!plan.files.length) return { ...plan, files: [] }
  if (!account) throw new Error('Could not verify the account for this file import.')
  const uploadLimit = policy === 'paid' ? PAID_ATTACHMENT_BYTES : FREE_ATTACHMENT_BYTES
  const byPage = new Map<number, Map<string, CloudArchiveFile>>()
  const digests = new Map<Uint8Array, string>()
  const files: BoundCloudFile[] = []
  for (const file of plan.files) {
    const filename = attachmentName(file.filename)
    if (!filename || !file.data.byteLength) throw new Error(`“${file.filename}” is empty or has an unsupported filename.`)
    if (file.data.byteLength > uploadLimit) {
      throw new Error(`“${filename}” is larger than this workspace’s ${uploadLimit / 1_000_000} MB file limit.`)
    }
    const page = byPage.get(file.ordinal) ?? new Map<string, CloudArchiveFile>()
    byPage.set(file.ordinal, page)
    const key = ['lekhan-archive-file-v1', account, plan.batches[0].importId, file.ordinal, page.size].join(':')
    const id = importUuid(await sha256(new TextEncoder().encode(key)))
    const digest = digests.get(file.data) ?? await sha256(new Uint8Array(file.data))
    digests.set(file.data, digest)
    const bound = { ...file, filename, id, sourceId: file.id, digest }
    page.set(file.id, bound)
    files.push(bound)
  }

  const batches = plan.batches.map(batch => ({ ...batch, pages: batch.pages.map(page => {
    const names = byPage.get(page.ordinal)
    if (!names) return page
    const markdown = mapMarkdownDestinations(page.markdown, destination => {
      const own = attachmentReference(destination)
      const file = own && names.get(own.id)
      return file && own ? attachmentDestination(file, own.fragment) : undefined
    })
    return { ...page, markdown }
  }) }))
  return { ...plan, files, batches }
}
