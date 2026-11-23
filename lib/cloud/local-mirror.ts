import type { Page, Workspace } from '../types'
import type { CloudImportBatch, CloudImportReceipt, LocalMirrorPlacement } from './import-plan'
import { uuidPattern } from './graph'

export function localMirrorPlacement(workspace: Workspace, selected: Page, notebook: string): LocalMirrorPlacement {
  const known = workspace.pages.flatMap(page => page.cloudMirror?.state === 'linked' &&
    (page.id === selected.parentId || page.parentId === selected.id)
    ? [{ key: page.id, parent: page.parentId, page: page.cloudMirror.pageId }] : [])
  return { notebook, key: selected.id, parent: selected.parentId, known }
}

export async function prepareLocalMirror(page: Page, signal: AbortSignal, localMirror: LocalMirrorPlacement) {
  const importId = crypto.randomUUID()
  const response = await fetch('/api/import?' + new URLSearchParams({ attempt: importId }), { cache: 'no-store', signal })
  if (!response.ok) throw new Error('Could not check your workspace’s sync settings.')
  const { prepareCloudImportImages } = await import('./prepare-images')
  const input: CloudImportBatch = { importId, index: 0, localMirror, pages: [{ ordinal: 0, parent: null,
    title: page.title, path: page.title, markdown: page.markdown,
    ...(page.frontmatter ? { frontmatter: page.frontmatter } : {}), ...(page.properties ? { properties: page.properties } : {}),
  }] }
  const prepared = await prepareCloudImportImages([input], await response.json())
  signal.throwIfAborted()
  return prepared.batches[0]
}

export class MirrorRejected extends Error {}

export async function uploadLocalMirror(batch: CloudImportBatch, signal: AbortSignal) {
  const response = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  }).catch(() => {
    signal.throwIfAborted()
    throw new Error('Could not confirm the cloud copy. Retry sync to recover it.')
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (body?.error === 'import_image_policy_changed') throw new MirrorRejected('The workspace plan changed. Choose Sync this page again.')
    if (body?.error === 'import_workspace_media_limit') throw new MirrorRejected('This page exceeds the remaining workspace storage. Free up space and retry.')
    if (response.status === 413) throw new MirrorRejected('This page is too large for the cloud upload. Try fewer or smaller images.')
    if (response.status === 400) throw new MirrorRejected('The cloud workspace could not accept this page. Check its title and properties.')
    throw new Error('Could not confirm the cloud copy. Retry sync to recover it.')
  }
  const receipt: CloudImportReceipt | null = await response.json().catch(() => null)
  const id = receipt?.pages?.[0]?.id
  if (typeof id !== 'string' || !uuidPattern.test(id)) throw new Error('Could not confirm the cloud copy. Retry sync to recover it.')
  return id
}
