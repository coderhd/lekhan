import { strFromU8 } from 'fflate'
import { parseDocument } from 'yaml'
import { readWorkspaceArchiveMetadata, workspaceManifestPath, type ArchivedNote } from './archive-metadata'
import { splitYamlFrontmatter } from './markdown'
import { fromMarkdownFile } from './workspace'
import type { VaultContents } from './vault-reader'

export interface ImportNote {
  sourcePath: string
  title: string
  markdown: string
  frontmatter?: string
  properties?: Record<string, unknown>
}

export interface VaultImportPlan {
  fingerprint: string
  notes: ImportNote[]
  directories: string[]
  images: Map<string, string>
  invalidProperties: number
  workspaceArchive?: true
}

export interface ImportReport {
  notes: number
  folders: number
  images: number
  resolved: number
  unresolved: number
  degraded: number
  invalidProperties: number
  repeated?: boolean
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

export function rasterMime(data: Uint8Array) {
  const view = strFromU8(data.subarray(0, 12), true)
  if (view.startsWith('\x89PNG\r\n\x1a\n')) return 'png'
  if (view.startsWith('\xff\xd8\xff')) return 'jpeg'
  if (view.startsWith('GIF87a') || view.startsWith('GIF89a')) return 'gif'
  if (view.startsWith('RIFF') && view.slice(8) === 'WEBP') return 'webp'
  if (view.startsWith('BM')) return 'bmp'
  if (view.slice(4) === 'ftypavif' || view.slice(4) === 'ftypavis') return 'avif'
  if (view.startsWith('\x00\x00\x01\x00')) return 'x-icon'
}

function digest(data: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.digest('SHA-256', data).then(buffer =>
    Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join(''),
  )
}

export function markdownNote(path: string, source: string, exported?: ArchivedNote): ImportNote & { invalidProperties?: boolean } {
  const metadata = splitYamlFrontmatter(source)
  const read = (body: string) => fromMarkdownFile(path, body, exported?.title, exported?.generatedHeading)
  if (!metadata) return { sourcePath: path, ...read(source) }
  if (metadata.raw.length > 256_000) return { sourcePath: path, ...read(source), invalidProperties: true }

  try {
    const document = parseDocument(metadata.yaml, { uniqueKeys: true })
    if (document.errors.length || document.warnings.length) throw new Error('Invalid YAML')
    // Disallow YAML aliases in imported metadata to avoid cycles and expansion.
    const properties: unknown = document.toJS({ maxAliasCount: 0 })
    if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('Expected a property map')
    const imported = read(metadata.body)
    const title = exported?.title ?? ('title' in properties && typeof properties.title === 'string' && properties.title.trim()
      ? properties.title : imported.title)
    return { sourcePath: path, title, markdown: imported.markdown, properties: properties as Record<string, unknown>, frontmatter: metadata.raw }
  } catch {
    return { sourcePath: path, ...read(source), invalidProperties: true }
  }
}

export async function planVaultImport(contents: VaultContents): Promise<VaultImportPlan> {
  const notes: ImportNote[] = []
  const images = new Map<string, string>()
  const files = [...contents.files].sort((left, right) => left.path < right.path ? -1 : Number(left.path !== right.path))
  const manifest = files.find(file => file.path === workspaceManifestPath)
  const archive = manifest && readWorkspaceArchiveMetadata(decoder.decode(manifest.data))
  const directories = new Set(contents.directories)
  if (!files.some(file => /\.(md|markdown)$/i.test(file.path))) throw new Error('No Markdown notes found in this vault.')

  let invalidProperties = 0
  const fingerprints = []
  for (const file of files) {
    if (file.path === workspaceManifestPath) {
      if (archive) fingerprints.push([file.path, await digest(new Uint8Array(file.data))])
      continue
    }
    const isMarkdown = /\.(md|markdown)$/i.test(file.path)
    if (isMarkdown) {
      const exported = archive && Object.hasOwn(archive.notes, file.path) ? archive.notes[file.path] : undefined
      const { invalidProperties: invalid, ...note } = markdownNote(file.path, decoder.decode(file.data), exported)
      if (invalid) invalidProperties++
      notes.push(note)
      const segments = file.path.split('/')
      for (let depth = 1; depth < segments.length; depth++) directories.add(segments.slice(0, depth).join('/'))
      if (notes.length > 2000 || (!archive && notes.length + directories.size > 2000)) throw new Error('A vault import can contain at most 2,000 pages and folders.')
    } else {
      const mime = rasterMime(file.data)
      if (!mime) continue
      images.set(file.path, 'data:image/' + mime + ';base64,' + btoa(strFromU8(file.data, true)))
    }
    fingerprints.push([file.path, await digest(new Uint8Array(file.data))])
  }

  if (archive && !notes.some(note => note.sourcePath.startsWith(archive.attachments + '/'))) {
    directories.delete(archive.attachments)
  }
  if (archive) {
    const notePaths = new Set(notes.map(note => note.sourcePath.replace(/\.md$/i, '')))
    const folders = [...directories].filter(directory => !notePaths.has(directory))
    if (notes.length + folders.length > 2000) throw new Error('A vault import can contain at most 2,000 pages and folders.')
  }
  return {
    fingerprint: await digest(encoder.encode(JSON.stringify([[...directories].sort(), fingerprints]))),
    notes,
    directories: [...directories].sort(),
    images,
    invalidProperties,
    ...(archive ? { workspaceArchive: true } : {}),
  }
}
