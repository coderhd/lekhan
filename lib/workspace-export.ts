import { strToU8, zip } from 'fflate'
import { workspaceManifestPath, type ArchivedNote, type WorkspaceArchiveMetadata } from './archive-metadata'
import { hasYamlFrontmatter, isEmbeddedRaster } from './markdown'
import { mapMarkdownDestinations } from './markdown-destinations'
import { wikiLinks } from './markdown-references'
import type { Page } from './types'
import { exportPage, pagePath, resolvePage } from './workspace'

const filesystemKey = (name: string) => name.normalize('NFC').toLowerCase()

export function safeFilename(name: string) {
  const safe = Array.from(name.replace(/[\\/:*?"<>|#[\]^%\p{Cc}]/gu, ' ').replace(/^[. ]+|[. ]+$/g, '')).slice(0, 60).join('')
    .replace(/[. ]+$/g, '') || 'Untitled'
  return /^(?:__macosx|con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(safe) ? '_' + safe : safe
}

function reserveName(base: string, used: Set<string>, unavailable?: Set<string>) {
  let name = base
  for (let suffix = 2; ; suffix++) {
    const key = filesystemKey(name)
    const file = key + '.md'
    if (!used.has(key) && !used.has(file) && !unavailable?.has(key)) {
      used.add(key)
      // A page can occupy both a Markdown filename and its child directory.
      used.add(file)
      return name
    }
    name = `${base} (${suffix})`
  }
}

function notePaths(pages: Page[]) {
  const paths = new Map<string, string>()
  const rootNames = new Set<string>()
  const namesByFolder = new Map([['', rootNames]])
  const ordered = pages.map(page => ({ page, ancestors: pagePath(pages, page.id).slice(0, -1) }))
    .sort((left, right) => left.ancestors.length - right.ancestors.length)
  for (const { page, ancestors } of ordered) {
    const folder = paths.get(ancestors.at(-1)?.id ?? '') ?? ''
    const used = namesByFolder.get(folder) ?? new Set<string>()
    namesByFolder.set(folder, used)
    const name = reserveName(safeFilename(page.title), used, folder ? rootNames : undefined)
    paths.set(page.id, folder ? folder + '/' + name : name)
  }
  return { paths, rootNames }
}

function linkTargets(markdown: string, pages: Page[], page: Page, paths: Map<string, string>) {
  const pieces = []
  let cursor = 0
  for (const link of wikiLinks(markdown, true)) {
    const anchorStart = link.target.indexOf('#')
    if (anchorStart === 0) continue
    const target = resolvePage(pages, link.target, page.id)
    const path = target && paths.get(target.id)
    if (!target || !path) continue
    const anchor = anchorStart < 0 ? '' : link.target.slice(anchorStart)
    const basename = path.split('/').at(-1)!
    const destination = basename.includes('.') ? path + '.md' : path
    const alias = link.alias ?? (basename !== target.title ? target.title.replace(/[\]\r\n]/g, ' ') : undefined)
    pieces.push(markdown.slice(cursor, link.start), `${link.embed ? '!' : ''}[[${destination}${anchor}${alias === undefined ? '' : '|' + alias}]]`)
    cursor = link.end
  }
  pieces.push(markdown.slice(cursor))
  return pieces.join('')
}

export function makeWorkspaceArchive(pages: Page[]): Promise<Uint8Array> {
  const { paths, rootNames } = notePaths(pages)
  const attachments = reserveName('Attachments', rootNames)
  const assets = new Map<string, string>()
  const files: Record<string, Uint8Array> = Object.create(null)
  const notes: Record<string, ArchivedNote> = Object.create(null)
  for (const page of pages) {
    const path = paths.get(page.id)!
    const filename = path + '.md'
    let markdown = linkTargets(page.markdown, pages, page, paths)
    if (/data:image\//i.test(markdown)) {
      const relative = '../'.repeat(path.split('/').length - 1)
      markdown = mapMarkdownDestinations(markdown, target => {
        if (!isEmbeddedRaster(target)) return
        let asset = assets.get(target)
        if (!asset) {
          const comma = target.indexOf(',')
          const mime = target.slice(11, target.indexOf(';')).toLowerCase()
          let data: string
          try { data = atob(target.slice(comma + 1)) }
          catch { return }
          const bytes = new Uint8Array(data.length)
          for (let index = 0; index < bytes.length; index++) bytes[index] = data.charCodeAt(index)
          const extension = mime === 'x-icon' ? 'ico' : mime === 'jpeg' ? 'jpg' : mime
          asset = `${attachments}/image-${assets.size + 1}.${extension}`
          assets.set(target, asset)
          files[asset] = bytes
        }
        return relative + asset.replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29')
      })
    }
    const serialized = exportPage({ ...page, markdown })
    notes[filename] = { title: page.title, generatedHeading: !hasYamlFrontmatter(serialized) }
    files[filename] = strToU8(serialized)
  }
  const manifest: WorkspaceArchiveMetadata = { version: 1, notes, attachments }
  files[workspaceManifestPath] = strToU8(JSON.stringify(manifest))
  return new Promise((resolve, reject) => zip(files, (error, archive) => error ? reject(error) : resolve(archive)))
}
