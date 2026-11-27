import { invoke } from '@tauri-apps/api/core'
import { hasYamlFrontmatter } from '../lib/markdown'
import { WorkspaceConflictError, type WorkspaceStorage } from '../lib/storage'
import type { Page, Workspace } from '../lib/types'
import { markdownNote } from '../lib/vault-import'
import { advanceNoteSidecar, openNoteSidecar, type NoteSidecar, type SidecarWrite } from './vault-yjs'
import { rebaseAttachmentReferences } from './vault-attachments'

export type VaultHandle = { token: string; label: string }
export type VaultFile = { path: string; text: string; modifiedMs: number }
type IndexPage = { id: string; path: string; folder?: boolean; favorite: boolean; createdAt: string; title?: string; sidecar?: string }
type VaultIndex = {
  version: 1
  revision: number
  activePageId: string | null
  pages: IndexPage[]
  vaultImports?: Workspace['vaultImports']
}
export type VaultAsset = { path: string; bytes: number; modifiedMs: number }
export type VaultSnapshot = { sequence: number; index: VaultIndex | null; files: VaultFile[]; sidecars?: NoteSidecar[]; recoveredDrafts?: boolean; assets?: VaultAsset[] }
type NoteChange = { path: string; before: string | null; after: string | null }
type VaultRead = {
  sequence: number
  bytes: number
  workspace: Workspace
  entries: Map<string, IndexPage>
  files: Map<string, VaultFile>
  sidecars: Map<string, NoteSidecar>
  changedOnDisk: Set<string>
}

const extension = /\.(?:md|markdown|mdown)$/i
const directory = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
const filename = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const join = (root: string, child: string) => root ? root + '/' + child : child
const folded = (path: string) => path.normalize('NFC').toLowerCase()
const encoder = new TextEncoder()

function portableName(title: string) {
  const name = [...title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '')]
    .slice(0, 70).join('').replace(/[. ]+$/g, '') || 'Untitled'
  return /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name) ? '_' + name : name
}

export function readMarkdownVault(snapshot: VaultSnapshot): VaultRead {
  const { files, index } = snapshot
  if (index && (index.version !== 1 || !Array.isArray(index.pages))) throw new Error('Unsupported vault index.')
  const fileMap = new Map(files.map(file => [file.path, file]))
  const sidecars = new Map(snapshot.sidecars?.map(sidecar => [sidecar.key, sidecar]))
  const changedOnDisk = new Set<string>()
  const saved = new Map<string, IndexPage>()
  const ids = new Set<string>()
  for (const entry of index?.pages ?? []) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.path !== 'string' ||
      typeof entry.favorite !== 'boolean' || typeof entry.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.createdAt)) ||
      (entry.title !== undefined && typeof entry.title !== 'string') ||
      (entry.sidecar !== undefined && typeof entry.sidecar !== 'string') ||
      ids.has(entry.id) || saved.has(entry.path)) throw new Error('Invalid vault index.')
    saved.set(entry.path, entry)
    ids.add(entry.id)
  }
  const folders = new Map<string, number>()
  const notesByStem = new Map<string, VaultFile>()
  let bytes = 0
  for (const file of files) {
    bytes += encoder.encode(file.text).byteLength
    const stem = file.path.replace(extension, '')
    if (!notesByStem.has(stem) || file.path.endsWith('.md')) notesByStem.set(stem, file)
    for (let parent = directory(file.path); parent; parent = directory(parent)) {
      const previous = folders.get(parent)
      if (previous !== undefined && previous >= file.modifiedMs) break
      folders.set(parent, file.modifiedMs)
    }
  }
  const folderId = (path: string) => {
    const file = notesByStem.get(path)
    return (file && saved.get(file.path)?.id) ?? saved.get(path)?.id ?? (file ? 'note:' + file.path : 'folder:' + path)
  }
  const entries = new Map<string, IndexPage>()
  const pages: Page[] = []
  for (const [path, modifiedMs] of [...folders].sort(([first], [second]) => first.localeCompare(second))) {
    if (notesByStem.has(path)) continue
    const previous = saved.get(path)
    const id = folderId(path)
    const parent = directory(path)
    const updatedAt = new Date(modifiedMs).toISOString()
    const createdAt = previous?.createdAt ?? updatedAt
    const title = previous?.title ?? filename(path)
    entries.set(id, { path, id, folder: true, favorite: previous?.favorite ?? false, createdAt, title })
    pages.push({ id, title, parentId: parent ? folderId(parent) : null, markdown: '', folder: true,
      favorite: previous?.favorite ?? false, createdAt, updatedAt })
  }
  for (const file of files) {
    const note = markdownNote(file.path, file.text)
    const previous = saved.get(file.path)
    const stem = file.path.replace(extension, '')
    const parent = directory(file.path)
    const id = previous?.id ?? (folders.has(stem) && notesByStem.get(stem) === file ? folderId(stem) : 'note:' + file.path)
    const updatedAt = new Date(file.modifiedMs).toISOString()
    const createdAt = previous?.createdAt ?? updatedAt
    const title = previous?.title ?? filename(stem)
    const favorite = previous?.favorite ?? false
    const sidecar = previous?.sidecar
    entries.set(id, { path: file.path, id, favorite, createdAt, title, sidecar })
    const state = sidecar ? sidecars.get(sidecar) : undefined
    if (state) {
      const document = openNoteSidecar(state)
      try {
        if (document.getText('source').toString() !== file.text) changedOnDisk.add(id)
      } finally {
        document.destroy()
      }
    }
    pages.push({ id, title, parentId: parent ? folderId(parent) : null, markdown: note.markdown,
      ...(note.properties ? { properties: note.properties } : {}), ...(note.frontmatter ? { frontmatter: note.frontmatter } : {}),
      favorite, createdAt, updatedAt })
  }
  return {
    sequence: snapshot.sequence, bytes, entries, files: fileMap, sidecars, changedOnDisk,
    workspace: {
      pages, revision: index?.revision ?? 0,
      activePageId: index?.activePageId && entries.has(index.activePageId) ? index.activePageId
        : pages.find(page => !entries.get(page.id)?.folder)?.id ?? null,
      ...(index?.vaultImports ? { vaultImports: index.vaultImports } : {}),
    },
  }
}

function noteText(page: Page, previous: Page | undefined, original: string | undefined) {
  if (original !== undefined && previous && previous.markdown === page.markdown && previous.frontmatter === page.frontmatter &&
    previous.title === page.title) return original
  if (!previous || original === undefined || previous.frontmatter !== page.frontmatter) return (page.frontmatter ?? '') + page.markdown
  const originalBody = original.slice(previous.frontmatter?.length ?? 0)
  const prefix = originalBody.endsWith(previous.markdown) ? originalBody.slice(0, originalBody.length - previous.markdown.length) : ''
  const keptPrefix = page.title === previous.title || !prefix.startsWith('# ') ? prefix
    : prefix.replace(/^# [^\r\n]+/, '# ' + page.title)
  return (page.frontmatter ?? '') + (hasYamlFrontmatter(page.markdown) ? '' : keptPrefix) + page.markdown
}

function vaultLayout(workspace: Workspace, baseline: VaultRead) {
  const previousPages = new Map(baseline.workspace.pages.map(page => [page.id, page]))
  const currentPages = new Map(workspace.pages.map(page => [page.id, page]))
  const parents = new Set(workspace.pages.flatMap(page => page.parentId ? [page.parentId] : []))
  const placed = new Map<string, IndexPage>()
  const inProgress = new Set<string>()
  // Reserve all original paths. A move or a deletion never replaces a different file.
  const owners = new Map([...baseline.entries].map(([id, entry]) => [folded(entry.path), id]))
  const directoryOwners = new Map([...baseline.entries].filter(([id, entry]) => entry.folder || parents.has(id))
    .map(([id, entry]) => [folded(entry.folder ? entry.path : entry.path.replace(extension, '')), id]))

  function place(page: Page): IndexPage {
    const done = placed.get(page.id)
    if (done) return done
    if (inProgress.has(page.id)) throw new Error('A vault page cannot contain itself.')
    inProgress.add(page.id)
    const parent = page.parentId ? currentPages.get(page.parentId) : undefined
    const parentEntry = parent ? place(parent) : undefined
    const enclosing = parentEntry ? parentEntry.folder ? parentEntry.path : parentEntry.path.replace(extension, '') : ''
    const oldEntry = baseline.entries.get(page.id)
    const oldPage = previousPages.get(page.id)
    const folder = !!(oldEntry?.folder || page.folder) && !page.markdown && !page.frontmatter
    const oldName = oldEntry ? filename(oldEntry.folder ? oldEntry.path : oldEntry.path.replace(extension, '')) : null
    const base = oldName && oldPage?.title === page.title ? oldName : portableName(page.title)
    const suffix = folder ? '' : oldEntry?.path.match(extension)?.[0] ?? '.md'
    let stem = join(enclosing, base)
    let path = stem + suffix
    for (let counter = 2; ; counter++) {
      const owner = owners.get(folded(path))
      const directoryOwner = directoryOwners.get(folded(stem))
      if ((!owner || owner === page.id) && (!directoryOwner || directoryOwner === page.id)) break
      stem = join(enclosing, base + ' (' + counter + ')')
      path = stem + suffix
    }
    if (oldEntry && folded(oldEntry.path) === folded(path)) path = oldEntry.path
    owners.set(folded(path), page.id)
    if (folder || parents.has(page.id)) directoryOwners.set(folded(stem), page.id)
    const entry = { id: page.id, path, ...(folder ? { folder } : {}), title: page.title,
      favorite: page.favorite, createdAt: page.createdAt, sidecar: oldEntry?.sidecar }
    placed.set(page.id, entry)
    inProgress.delete(page.id)
    return entry
  }

  for (const page of workspace.pages) place(page)
  return placed
}

export function rebaseVaultWorkspace(previous: Workspace, next: Workspace, baseline: VaultRead, assets: Map<string, VaultAsset>) {
  if (!assets.size || previous.pages === next.pages) return next
  const structureChanged = next.pages.length !== previous.pages.length || next.pages.some((page, index) => {
    const before = previous.pages[index]
    return before.id !== page.id || before.title !== page.title || before.parentId !== page.parentId
  })
  if (!structureChanged) return next

  const before = vaultLayout(previous, baseline)
  const after = vaultLayout(next, baseline)
  let changed = false
  const pages = next.pages.map(page => {
    const from = before.get(page.id)
    const to = after.get(page.id)
    if (!from || !to || from.path === to.path || !page.markdown) return page
    const markdown = rebaseAttachmentReferences(page.markdown, from.path, to.path, assets)
    if (markdown === page.markdown) return page
    changed = true
    return { ...page, markdown, updatedAt: new Date().toISOString() }
  })
  return changed ? { ...next, pages } : next
}

export function prepareVaultSave(workspace: Workspace, baseline: VaultRead, expectedRevision: number) {
  const previousPages = new Map(baseline.workspace.pages.map(page => [page.id, page]))
  const pages = new Map(workspace.pages.map(page => [page.id, page]))
  const placed = vaultLayout(workspace, baseline)
  const desired = new Map<string, string>()
  for (const [id, entry] of placed) {
    const page = pages.get(id)
    if (!page || entry.folder) continue
    const oldPath = baseline.entries.get(id)?.path
    desired.set(entry.path, noteText(page, previousPages.get(id), oldPath ? baseline.files.get(oldPath)?.text : undefined))
  }
  const changes: NoteChange[] = []
  for (const [path, text] of desired) {
    const before = baseline.files.get(path)?.text ?? null
    if (before !== text) changes.push({ path, before, after: text })
  }
  for (const [path, file] of baseline.files) {
    if (!desired.has(path)) changes.push({ path, before: file.text, after: null })
  }
  const index: VaultIndex = { version: 1, revision: expectedRevision + 1, activePageId: workspace.activePageId,
    pages: [...placed.values()], ...(workspace.vaultImports ? { vaultImports: workspace.vaultImports } : {}) }
  return { changes, index, desired }
}

export function prepareVaultJournal(index: VaultIndex, desired: Map<string, string>, baseline: VaultRead) {
  const sidecars = new Map<string, NoteSidecar>()
  const updates: SidecarWrite[] = []
  for (const entry of index.pages) {
    const next = desired.get(entry.path)
    if (next === undefined) continue
    const previous = baseline.entries.get(entry.id)
    const onDisk = previous ? baseline.files.get(previous.path)?.text : undefined
    const key = entry.sidecar
    const record = key ? baseline.sidecars.get(key) : undefined
    if (record) sidecars.set(record.key, record)
    if (onDisk === next && !baseline.changedOnDisk.has(entry.id)) continue
    const advanced = advanceNoteSidecar(key ?? crypto.randomUUID(), record, onDisk ?? '', next)
    if (advanced) {
      entry.sidecar = advanced.sidecar.key
      sidecars.set(advanced.sidecar.key, advanced.sidecar)
      updates.push(advanced.write)
    }
  }
  return { sidecars, updates }
}

type VaultEvents = {
  recovered: () => void
  files: (paths: Map<string, string>, assets?: VaultAsset[]) => void
}

export function vaultStorage(handle: VaultHandle, events: VaultEvents): WorkspaceStorage & { rememberAttachment: (path: string) => void } {
  const token = handle.token
  const cache = new WeakMap<Workspace, VaultRead>()
  const copied = new Map<string, VaultAsset>()
  let assets = new Map<string, VaultAsset>()
  return {
    rememberAttachment(path) {
      if (assets.has(path)) return
      const asset = { path, bytes: 0, modifiedMs: 0 }
      copied.set(path, asset)
      assets.set(path, asset)
    },
    prepareChange(previous, next, baseline) {
      const cached = baseline && cache.get(baseline)
      return cached ? rebaseVaultWorkspace(previous, next, cached, assets) : next
    },
    async load() {
      const snapshot = await invoke<VaultSnapshot>('read_vault', { token })
      const read = readMarkdownVault(snapshot)
      assets = new Map(snapshot.assets?.map(asset => [asset.path, asset]))
      // A read started before the picker returned may still be in flight.
      for (const [path, asset] of copied) {
        if (assets.has(path)) copied.delete(path)
        else assets.set(path, asset)
      }
      if (snapshot.recoveredDrafts) events.recovered()
      events.files(new Map([...read.entries].map(([id, entry]) => [id, entry.path])), snapshot.assets ?? [])
      cache.set(read.workspace, read)
      return read.workspace
    },
    async hasChanges(baseline) {
      const cached = baseline && cache.get(baseline)
      const sequence = await invoke<number>('vault_sequence', { token })
      return !cached || cached.sequence !== sequence
    },
    async save(workspace, expectedRevision, baseline) {
      const cached = baseline && cache.get(baseline)
      if (!cached) throw new WorkspaceConflictError()
      const { changes, index, desired } = prepareVaultSave(workspace, cached, expectedRevision)
      let bytes = cached.bytes
      for (const change of changes) {
        bytes += (change.after === null ? 0 : encoder.encode(change.after).byteLength)
          - (change.before === null ? 0 : encoder.encode(change.before).byteLength)
      }
      if (bytes > 128 * 1024 * 1024) throw new Error('The Markdown vault exceeds the local editor limit.')
      const journal = prepareVaultJournal(index, desired, cached)
      try {
        await invoke('write_vault', { token, changes, expectedRevision, index, sidecars: journal.updates })
        const result = { ...workspace, revision: index.revision }
        const files = new Map([...desired].map(([path, text]) => [path, {
          path, text, modifiedMs: cached.files.get(path)?.modifiedMs ?? Date.now(),
        }]))
        cache.set(workspace, { sequence: cached.sequence, bytes, entries: new Map(index.pages.map(entry => [entry.id, entry])),
          workspace: result, files, sidecars: journal.sidecars, changedOnDisk: new Set() })
        events.files(new Map(index.pages.map(entry => [entry.id, entry.path])))
        return result
      } catch (error) {
        if (error === 'vault_conflict') throw new WorkspaceConflictError()
        throw error
      }
    },
  }
}
