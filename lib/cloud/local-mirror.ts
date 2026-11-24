import type { LocalAttachment, Page, Workspace } from '../types'
import { bindCloudImportFiles, type CloudImportBatch, type CloudImportReceipt, type LocalMirrorPlacement } from './import-plan'
import { uploadImportedAttachment } from './attachment-client'
import { attachmentName, PAID_ATTACHMENT_BYTES } from './attachments'
import { uuidPattern } from './graph'
import { starterWorkspace } from '../starter-workspace'

export interface PendingLocalMirror {
  state: 'pending'
  batch: CloudImportBatch
  account?: string
  files?: { sourceId: string; id: string; filename: string; digest: string; bytes: number }[]
}

const samples = new Map(starterWorkspace().pages.map(page => [page.id, page]))

export function hasUnsupportedMirrorFile(page: Page) {
  return page.files?.some(file => !attachmentName(file.filename) || !file.data.byteLength || file.data.byteLength > PAID_ATTACHMENT_BYTES) ?? false
}

export function nextAutomaticMirror(pages: Page[], editingPage?: string) {
  const queued = pages.find(page => page.cloudMirror?.state === 'pending' && page.cloudMirror.batch.localMirror)
  if (queued) return queued

  const byId = new Map(pages.map(page => [page.id, page]))
  const candidates = new Set<string>()
  for (const page of pages) {
    const sample = samples.get(page.id)
    if (sample && page.title === sample.title && page.markdown === sample.markdown &&
      page.parentId === sample.parentId && !page.frontmatter && !page.properties && !page.files?.length && !page.cloudMirror) continue
    let parent: Page | undefined = page
    while (parent && !candidates.has(parent.id)) {
      candidates.add(parent.id)
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    }
  }
  return pages.find(page => !page.cloudMirror && page.id !== editingPage && candidates.has(page.id) && !hasUnsupportedMirrorFile(page))
}

export function localMirrorPlacement(workspace: Workspace, selected: Page, notebook: string): LocalMirrorPlacement {
  const known = workspace.pages.flatMap(page => page.cloudMirror?.state === 'linked' &&
    (page.id === selected.parentId || page.parentId === selected.id)
    ? [{ key: page.id, parent: page.parentId, page: page.cloudMirror.pageId }] : [])
  return { notebook, key: selected.id, parent: selected.parentId, known }
}

export async function prepareLocalMirror(page: Page, signal: AbortSignal, localMirror: LocalMirrorPlacement, automatic = false): Promise<PendingLocalMirror> {
  const importId = crypto.randomUUID()
  const params = new URLSearchParams({ attempt: importId })
  if (automatic) params.set('sync', 'automatic')
  const response = await fetch('/api/import?' + params, { cache: 'no-store', signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (body?.error === 'import_paid_sync_ended') throw automaticMirrorUnavailable()
    throw new Error('Could not check your workspace’s sync settings.')
  }
  const { prepareCloudImportImages } = await import('./prepare-images')
  const input: CloudImportBatch = { importId, index: 0, localMirror, pages: [{ ordinal: 0, parent: null,
    title: page.title, path: page.title, markdown: page.markdown,
    ...(page.frontmatter ? { frontmatter: page.frontmatter } : {}), ...(page.properties ? { properties: page.properties } : {}),
  }] }
  const settings = await response.json()
  const { batches } = await prepareCloudImportImages([input], settings)
  const bound = await bindCloudImportFiles({ batches, files: (page.files ?? []).map(file => ({ ...file, ordinal: 0 })) }, settings.account, settings.current)
  signal.throwIfAborted()
  return { state: 'pending', batch: bound.batches[0], account: settings.account,
    ...(bound.files.length ? { files: bound.files.map(({ sourceId, id, filename, digest, data }) => ({
      sourceId, id, filename, digest, bytes: data.byteLength,
    })) } : {}),
  }
}

export class MirrorRejected extends Error {}
export class AutomaticMirrorUnavailable extends Error {}

function automaticMirrorUnavailable() {
  return new AutomaticMirrorUnavailable('Automatic sync is paused. You can still choose pages to sync.')
}

export async function uploadLocalMirror(pending: PendingLocalMirror, localFiles: LocalAttachment[], signal: AbortSignal, automatic = false) {
  const { batch, account } = pending
  const sources = new Map(localFiles.map(file => [file.id, file.data]))
  const files = (pending.files ?? []).map(file => {
    const data = sources.get(file.sourceId)
    if (!account || data?.byteLength !== file.bytes) throw new Error('A file in the saved sync draft could not be read from this notebook.')
    return { ...file, data }
  })
  const response = await fetch(automatic ? '/api/import?sync=automatic' : '/api/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(account ? { 'X-Lekhan-Account': account } : {}) },
    body: JSON.stringify(batch), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  }).catch(() => {
    signal.throwIfAborted()
    throw new Error('Could not confirm the cloud copy. Retry sync to recover it.')
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (body?.error === 'import_paid_sync_ended') throw automaticMirrorUnavailable()
    if (body?.error === 'account_changed') throw new Error('Sign back into the account that started this sync.')
    if (body?.error === 'import_image_policy_changed') throw new MirrorRejected('The workspace plan changed. Choose Sync this page again.')
    if (body?.error === 'import_workspace_media_limit') throw new MirrorRejected('This page exceeds the remaining workspace storage. Free up space and retry.')
    if (response.status === 413) throw new MirrorRejected('This page is too large for the cloud upload. Try fewer or smaller images.')
    if (response.status === 400) throw new MirrorRejected('The cloud workspace could not accept this page. Check its title and properties.')
    throw new Error('Could not confirm the cloud copy. Retry sync to recover it.')
  }
  const receipt: CloudImportReceipt | null = await response.json().catch(() => null)
  const id = receipt?.pages?.[0]?.id
  if (typeof id !== 'string' || !uuidPattern.test(id)) throw new Error('Could not confirm the cloud copy. Retry sync to recover it.')
  for (const file of files) await uploadImportedAttachment(id, file, account, signal)
  return id
}
