import { VaultImportError } from './vault-import-error'
import { lexer, type Token, type Tokens } from 'marked'
import { stringify } from 'yaml'
import type { LocalAttachment, Page, PageChoice, Workspace } from './types'
import { wikiLinks } from './markdown-references'
import { mapMarkdownDestinations } from './markdown-destinations'
import { attachmentDestination, vaultFileIndex } from './local-attachments'
export { searchPages } from './workspace-search'
import { hasYamlFrontmatter } from './markdown'
import type { ImportNote, ImportReport, VaultImportPlan } from './vault-import'

type PageInput = Partial<Pick<Page, 'title' | 'parentId' | 'markdown' | 'frontmatter' | 'properties'>>
type PagePatch = PageInput & Partial<Pick<Page, 'favorite'>>

function normalize(text: string) {
  return text.trim().normalize('NFC').toLowerCase()
}

function cleanTitle(title: string) {
  return title.replace(/[\[\]|/#\\\s]+/g, ' ').trim() || 'Untitled'
}

function uniqueTitle(pages: Page[], parentId: string | null, title: string, excludeId?: string) {
  const siblingTitles = new Set(
    pages.filter((page) => page.parentId === parentId && page.id !== excludeId).map((page) => normalize(page.title)),
  )
  const base = cleanTitle(title)
  let candidate = base
  for (let suffix = 2; siblingTitles.has(normalize(candidate)); suffix++) {
    candidate = `${base} ${suffix}`
  }
  return candidate
}

export type PageLocation = Pick<Page, 'id' | 'title' | 'parentId'>

function pathFromMap<T extends PageLocation>(pages: Map<string, T>, id: string) {
  const path: T[] = []
  const visited = new Set<string>()
  let current = pages.get(id)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    path.push(current)
    current = current.parentId ? pages.get(current.parentId) : undefined
  }
  return path.reverse()
}

const pagesBySnapshot = new WeakMap<Page[], Map<string, Page>>()
interface PageResolver {
  canonicalPath: (page: PageLocation, explicit?: boolean) => string
  resolveTarget: (target: string, sourceId?: string) => PageLocation | undefined
  choices: () => PageChoice[]
  backlink: (page: Page, targetId: string) => string | undefined
  path: (id: string) => readonly PageLocation[]
}
const resolversBySnapshot = new WeakMap<Page[], PageResolver>()
const linksByPage = new WeakMap<Page, ReturnType<typeof wikiLinks>>()
type Backlink = { start: number; end: number; excerpt?: string }
type BacklinkMatch = { page: Page; excerpt: string }
const backlinksBySnapshot = new WeakMap<Page[], { id: string; matches: BacklinkMatch[] }>()
const navigationBySnapshot = new WeakMap<Page[], {
  childPages: ReadonlyMap<string | null, readonly PageLocation[]>
  favorites: readonly PageLocation[]
  path: PageResolver['path']
}>()

function pageIndex(pages: Page[]) {
  let index = pagesBySnapshot.get(pages)
  if (!index) {
    index = new Map(pages.map(page => [page.id, page]))
    pagesBySnapshot.set(pages, index)
  }
  return index
}

export function pagePath(pages: Page[], id: string) {
  return pathFromMap(pageIndex(pages), id)
}

function buildResolver(pages: Page[]): PageResolver {
  const cached = resolversBySnapshot.get(pages)
  if (cached) return cached
  const locations = pages.map(({ id, title, parentId }) => ({ id, title, parentId }))
  const pagesById = new Map(locations.map(page => [page.id, page]))
  const pathsById = new Map(locations.map(page => [page.id, pathFromMap(pagesById, page.id)]))
  const byPath = new Map<string, PageLocation>()
  const byTitle = new Map<string, PageLocation[]>()
  const backlinksByPage = new WeakMap<Page, Map<string, Backlink>>()
  let choices: PageChoice[] | undefined

  for (const page of locations) {
    const title = normalize(page.title)
    const sameTitlePages = byTitle.get(title) ?? []
    sameTitlePages.push(page)
    byTitle.set(title, sameTitlePages)
    const path = pathsById.get(page.id)?.map((item) => normalize(item.title)).join('/')
    if (path) byPath.set(path, page)
  }

  function canonicalPath(page: PageLocation, explicit = false) {
    const path = pathsById.get(page.id)?.map(({ title }) => title).join('/') ?? page.title
    const ambiguousRootTitle = (byTitle.get(normalize(page.title))?.length ?? 0) > 1
    return !page.parentId && (explicit || ambiguousRootTitle) ? `/${path}` : path
  }

  function resolveTarget(target: string, sourceId?: string): PageLocation | undefined {
    const withoutAnchor = target.split('#', 1)[0]?.trim()
    if (!withoutAnchor) return sourceId ? pagesById.get(sourceId) : undefined

    const segments = withoutAnchor.split('/').map(normalize).filter(Boolean)
    const normalized = segments.join('/')
    const withoutExtension = normalized.replace(/\.(?:md|markdown|mdown)$/i, '')
    if (segments.length > 1 || withoutAnchor.startsWith('/')) {
      return byPath.get(normalized) ?? byPath.get(withoutExtension)
    }

    const matches = byTitle.get(normalized) ?? byTitle.get(withoutExtension) ?? []
    if (matches.length < 2) return matches[0]
    if (!sourceId) return undefined
    const sourcePath = pathsById.get(sourceId)
    if (!sourcePath) return undefined

    let best: PageLocation | undefined
    let bestDistance = Infinity
    for (const match of matches) {
      const matchPath = pathsById.get(match.id) ?? []
      let shared = 0
      while (shared < sourcePath.length && sourcePath[shared]?.id === matchPath[shared]?.id) shared++
      const distance = sourcePath.length + matchPath.length - 2 * shared
      if (distance < bestDistance) {
        best = match
        bestDistance = distance
      } else if (distance === bestDistance) {
        best = undefined
      }
    }
    return best
  }

  function backlink(page: Page, targetId: string) {
    let targets = backlinksByPage.get(page)
    if (!targets) {
      targets = new Map()
      let links = linksByPage.get(page)
      if (!links) {
        links = wikiLinks(page.markdown)
        linksByPage.set(page, links)
      }
      for (const { target, start, end } of links) {
        const match = resolveTarget(target, page.id)
        if (match && !targets.has(match.id)) targets.set(match.id, { start, end })
      }
      backlinksByPage.set(page, targets)
    }
    const link = targets.get(targetId)
    if (!link) return undefined
    if (link.excerpt === undefined) {
      const lineStart = page.markdown.lastIndexOf('\n', Math.max(0, link.start - 1)) + 1
      const lineBreak = page.markdown.indexOf('\n', link.end)
      const lineEnd = lineBreak < 0 ? page.markdown.length : lineBreak
      const line = page.markdown.slice(lineStart, lineEnd).trim()
      const excerpt = line.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias ?? target.split('/').at(-1))
      link.excerpt = excerpt.length > 155 ? `${excerpt.slice(0, 152).trimEnd()}…` : excerpt
    }
    return link.excerpt
  }

  const resolver = {
    canonicalPath, resolveTarget, backlink,
    choices: () => choices ??= locations.map(page => ({ id: page.id, title: page.title, path: canonicalPath(page) })),
    path: (id: string) => pathsById.get(id) ?? [],
  }
  resolversBySnapshot.set(pages, resolver)
  return resolver
}

export function resolvePage(pages: Page[], target: string, sourceId?: string) {
  const match = buildResolver(pages).resolveTarget(target, sourceId)
  return match && pageIndex(pages).get(match.id)
}

export function pageChoices(pages: Page[]): PageChoice[] {
  return buildResolver(pages).choices()
}

export function notebookNavigation(pages: Page[]) {
  const cached = navigationBySnapshot.get(pages)
  if (cached) return cached
  const childPages = new Map<string | null, PageLocation[]>()
  const favorites: PageLocation[] = []
  for (const { id, title, parentId, favorite } of pages) {
    const location = { id, title, parentId }
    const siblings = childPages.get(parentId)
    if (siblings) siblings.push(location)
    else childPages.set(parentId, [location])
    if (favorite) favorites.push(location)
  }
  const navigation = { childPages, favorites, path: buildResolver(pages).path }
  navigationBySnapshot.set(pages, navigation)
  return navigation
}

function keepResolvedLinks(previous: Page[], next: Page[], now: string) {
  const before = buildResolver(previous)
  const after = buildResolver(next)
  const oldIds = new Set(previous.map((page) => page.id))
  const newPagesById = new Map(next.map((page) => [page.id, page]))
  return next.map((page) => {
    if (!oldIds.has(page.id) || page.cloudMirror) return page
    const replacements = wikiLinks(page.markdown).flatMap((link) => {
      const target = before.resolveTarget(link.target, page.id)
      if (!target || after.resolveTarget(link.target, page.id)?.id === target.id) return []

      const targetPage = newPagesById.get(target.id)
      const newTarget = targetPage ? after.canonicalPath(targetPage) : before.canonicalPath(target, true)
      const anchorStart = link.target.indexOf('#')
      const anchor = anchorStart < 0 ? '' : link.target.slice(anchorStart)
      const alias = link.alias === undefined ? '' : `|${link.alias}`
      return [{ start: link.start, end: link.end, value: `[[${newTarget}${anchor}${alias}]]` }]
    })
    if (!replacements.length) return page

    let cursor = 0
    let markdown = ''
    for (const { start, end, value } of replacements) {
      markdown += page.markdown.slice(cursor, start) + value
      cursor = end
    }
    markdown += page.markdown.slice(cursor)
    return { ...page, markdown, updatedAt: now }
  })
}

function newPage(pages: Page[], input: PageInput, parentId: string | null, now: string): Page {
  return {
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    parentId,
    title: uniqueTitle(pages, parentId, input.title ?? 'Untitled'),
    markdown: input.markdown ?? '',
    ...(input.properties ? { properties: input.properties } : {}),
    ...(input.frontmatter ? { frontmatter: input.frontmatter } : {}),
    favorite: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function createPage(workspace: Workspace, input: PageInput = {}): Workspace {
  const { pages } = workspace
  const parentId = pages.some((page) => page.id === input.parentId) ? input.parentId ?? null : null
  const now = new Date().toISOString()
  const page = newPage(pages, input, parentId, now)
  return { ...workspace, pages: keepResolvedLinks(pages, [...pages, page], now), activePageId: page.id }
}

function findVaultTarget<T>(index: Map<string, T>, target: string, sourcePath: string) {
  const key = normalize(target)
  if (!key) return undefined
  const folder = normalize(sourcePath).split('/').slice(0, -1)
  const segments = key.startsWith('/') ? [] : [...folder]
  for (const part of key.split('/').filter(Boolean)) {
    if (part === '..') segments.pop()
    else if (part !== '.') segments.push(part)
  }
  const relativeMatch = index.get(segments.join('/'))
  if (relativeMatch !== undefined) return relativeMatch
  if (key.startsWith('/') || key.startsWith('.')) return undefined

  const absoluteMatch = index.get(key)
  if (absoluteMatch !== undefined) return absoluteMatch
  const usable = [...index].filter(([path]) => path.endsWith('/' + key))
  return usable.length === 1 ? usable[0][1] : undefined
}

export function applyVaultImport(workspace: Workspace, plan: VaultImportPlan, { relativeImages = true } = {}): { workspace: Workspace; report: ImportReport } {
  const previous = workspace.vaultImports?.[plan.fingerprint]
  if (previous) {
    const activePageId = workspace.pages.some(page => page.id === previous.firstPageId)
      ? previous.firstPageId : workspace.activePageId
    return { workspace: activePageId === workspace.activePageId ? workspace : { ...workspace, activePageId }, report: { ...previous.report, repeated: true } }
  }

  const now = new Date().toISOString()
  const pages = [...workspace.pages]
  const folders = new Map<string, string>()
  const directoryOf = (path: string) => path.split('/').slice(0, -1).join('/')
  const folderNotes = new Map<string, ImportNote>()
  if (plan.workspaceArchive) {
    for (const note of plan.notes) folderNotes.set(note.sourcePath.replace(/\.md$/i, ''), note)
  }
  const mergedFolders = new Map<string, Page>()
  for (const folder of plan.directories) {
    const note = folderNotes.get(folder)
    const title = folder.split('/').at(-1) ?? folder
    const created = newPage(pages, note ?? { title }, folders.get(directoryOf(folder)) ?? null, now)
    if (note) mergedFolders.set(note.sourcePath, created)
    pages.push(created)
    folders.set(folder, created.id)
  }

  const importedNotes = plan.notes.map(note => {
    const merged = mergedFolders.get(note.sourcePath)
    if (merged) return { note, page: merged }
    const page = newPage(pages, note, folders.get(directoryOf(note.sourcePath)) ?? null, now)
    pages.push(page)
    return { note, page }
  })
  const firstPageId = importedNotes[0].page.id
  const { canonicalPath, resolveTarget } = buildResolver(pages)
  const pathWithoutExtension = (path: string) => normalize(path).replace(/\.(md|markdown)$/i, '')
  const notePaths = new Map(importedNotes.map(({ note, page }) => [pathWithoutExtension(note.sourcePath), page]))
  const images = new Map([...plan.images].map(([path, data]) => [normalize(path), data]))
  const localFiles = new Map<string, LocalAttachment>([...(plan.attachments ?? [])].map(([path, data]) => [path, {
    id: crypto.randomUUID(), filename: path.split('/').at(-1)!, data,
  }]))
  const findFile = vaultFileIndex(localFiles)
  const findImage = vaultFileIndex(plan.images)
  const usedFiles = new Set<string>()
  const usedImages = new Set<string>()
  const report: ImportReport = {
    notes: importedNotes.length, folders: folders.size - mergedFolders.size, images: 0,
    resolved: 0, unresolved: 0, degraded: 0, invalidProperties: plan.invalidProperties,
  }
  let outputSize = 0
  for (const { page, note } of importedNotes) {
    const files = new Map<string, LocalAttachment>()
    const register = (file: LocalAttachment) => {
      files.set(file.id, file)
      usedFiles.add(file.id)
    }
    for (const path of note.files ?? []) {
      const file = localFiles.get(path)
      if (file) register(file)
      else report.degraded++
    }
    let body = ''
    let cursor = 0
    for (const link of wikiLinks(note.markdown, true)) {
      const [path] = link.target.split('#', 1)
      const anchor = link.target.slice(path.length)
      const picture = link.embed ? findVaultTarget(images, path, note.sourcePath) : undefined
      const file = findFile(path, note.sourcePath, true)
      body += note.markdown.slice(cursor, link.start)
      if (picture) {
        usedImages.add(picture)
        const label = path.split('/').at(-1)?.replace(/[\[\]\\]/g, '') || 'Imported image'
        const width = /^\d{1,4}(?:x\d{1,4})?$/.test(link.alias ?? '') ? ' "lekhan-size:' + link.alias + '"' : ''
        body += '![' + label + '](' + picture + width + ')'
      } else if (file) {
        if (link.embed) report.degraded++
        register(file)
        const label = (link.alias ?? file.filename).replace(/[\\[\]]/g, '\\$&')
        body += '[' + label + '](' + attachmentDestination(file, anchor) + ')'
      } else {
        if (link.embed && !plan.workspaceArchive) report.degraded++
        const target = (plan.workspaceArchive ? notePaths.get(pathWithoutExtension(path)) : undefined)
          ?? findVaultTarget(notePaths, pathWithoutExtension(path), note.sourcePath)
          ?? resolveTarget(link.target, page.id)
        if (target) report.resolved++
        else report.unresolved++
        const parsedTarget = target && path ? canonicalPath(target, true) + anchor : link.target
        if (plan.workspaceArchive && !target) body += note.markdown.slice(link.start, link.end)
        else body += (link.embed && plan.workspaceArchive ? '!' : '') + '[[' + parsedTarget
          + (link.alias === undefined ? '' : '|' + link.alias) + ']]'
      }
      if (outputSize + body.length > 140_000_000) throw new VaultImportError('embeddedImagesLimit', 'Embedded images make this vault too large to import.')
      cursor = link.end
    }
    page.markdown = body + note.markdown.slice(cursor)
    if ((plan.workspaceArchive || plan.attachments) && (plan.images.size || localFiles.size)) {
      page.markdown = mapMarkdownDestinations(page.markdown, target => {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return
        const delimiter = target.search(/[?#]/)
        const fragment = delimiter < 0 ? '' : target.slice(delimiter)
        let path: string
        try { path = decodeURIComponent(delimiter < 0 ? target : target.slice(0, delimiter)) }
        catch { return }
        const file = findFile(path, note.sourcePath, false)
        if (file) {
          register(file)
          return attachmentDestination(file, fragment)
        }
        const image = plan.workspaceArchive || relativeImages ? findImage(path, note.sourcePath, false) : undefined
        if (image) usedImages.add(image)
        return image
      })
    }
    if (files.size) page.files = [...files.values()]
    outputSize += page.markdown.length
    if (outputSize > 140_000_000) throw new VaultImportError('embeddedImagesLimit', 'Embedded images make this vault too large to import.')
  }
  report.images = usedImages.size
  if (plan.attachments?.size) report.files = usedFiles.size
  const omitted = (plan.omittedFiles ?? 0) + (plan.attachments?.size ?? 0) - usedFiles.size
  if (omitted) report.omittedFiles = omitted
  return {
    workspace: {
      ...workspace,
      pages: keepResolvedLinks(workspace.pages, pages, now),
      activePageId: firstPageId,
      vaultImports: { ...workspace.vaultImports, [plan.fingerprint]: { firstPageId, report } },
    },
    report,
  }
}

export function updatePage(workspace: Workspace, id: string, patch: PagePatch): Workspace {
  const index = workspace.pages.findIndex((current) => current.id === id)
  const page = index < 0 ? undefined : workspace.pages[index]
  if (!page) return workspace
  const parentId = patch.parentId === undefined ? page.parentId : patch.parentId
  if (parentId) {
    const targetPath = resolversBySnapshot.get(workspace.pages)?.path(parentId) ?? pagePath(workspace.pages, parentId)
    if (!targetPath.length || targetPath.some((ancestor) => ancestor.id === id)) return workspace
  }
  const title = patch.title !== undefined || parentId !== page.parentId
    ? uniqueTitle(workspace.pages, parentId, patch.title ?? page.title, id)
    : page.title
  const markdown = patch.markdown ?? page.markdown
  const favorite = patch.favorite ?? page.favorite
  const metadataChanged = parentId !== page.parentId || title !== page.title
  if (!metadataChanged && markdown === page.markdown && favorite === page.favorite) return workspace

  const now = new Date().toISOString()
  const updated = { ...page, parentId, title, markdown, favorite, updatedAt: now }
  const pages = workspace.pages.slice()
  pages[index] = updated
  if (metadataChanged) return { ...workspace, pages: keepResolvedLinks(workspace.pages, pages, now) }
  // A content edit keeps paths and title resolution valid. Backlinks for the
  // edited page are recalculated from its new object when requested.
  const resolver = resolversBySnapshot.get(workspace.pages)
  if (resolver) resolversBySnapshot.set(pages, resolver)
  const navigation = navigationBySnapshot.get(workspace.pages)
  if (navigation && favorite === page.favorite) navigationBySnapshot.set(pages, navigation)
  // The edited note cannot affect its own inbound links, which exclude itself.
  const backlinks = backlinksBySnapshot.get(workspace.pages)
  if (backlinks?.id === id) backlinksBySnapshot.set(pages, backlinks)
  return { ...workspace, pages }
}

export function deletePage(workspace: Workspace, id: string): Workspace {
  const deleted = workspace.pages.find((page) => page.id === id)
  if (!deleted) return workspace
  const children = new Map<string, Page[]>()
  for (const page of workspace.pages) {
    if (!page.parentId) continue
    const siblings = children.get(page.parentId) ?? []
    siblings.push(page)
    children.set(page.parentId, siblings)
  }
  const removed = new Set<string>()
  const pending = [id]
  while (pending.length) {
    const current = pending.pop()!
    if (removed.has(current)) continue
    removed.add(current)
    for (const page of children.get(current) ?? []) pending.push(page.id)
  }
  const persisted = workspace.pages.filter((page) => !removed.has(page.id))
  const pages = keepResolvedLinks(workspace.pages, persisted, new Date().toISOString())
  const activePageId = workspace.activePageId && removed.has(workspace.activePageId)
    ? deleted.parentId ?? pages[0]?.id ?? null
    : workspace.activePageId
  return { ...workspace, pages, activePageId }
}

export function getBacklinks(pages: Page[], id: string) {
  const cached = backlinksBySnapshot.get(pages)
  if (cached?.id === id) return cached.matches
  const { backlink } = buildResolver(pages)
  const matches: BacklinkMatch[] = []
  for (const page of pages) {
    if (page.id === id) continue
    const excerpt = backlink(page, id)
    if (excerpt !== undefined) matches.push({ page, excerpt })
  }
  backlinksBySnapshot.set(pages, { id, matches })
  return matches
}

function inlineText(tokens: Token[]): string {
  return tokens.map(token => {
    if ('tokens' in token && Array.isArray(token.tokens)) return inlineText(token.tokens)
    if (!('text' in token) || typeof token.text !== 'string') return ''
    if (token.type !== 'text') return token.text
    return token.text.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target)
  }).join('')
}

export function pageHeadings(markdown: string) {
  let cursor = 0
  return lexer(markdown).filter((token): token is Tokens.Heading => token.type === 'heading')
    .map(token => {
      const offset = markdown.indexOf(token.raw.trimEnd(), cursor)
      if (offset >= 0) cursor = offset + token.raw.trimEnd().length
      return { text: inlineText(token.tokens).trim(), level: token.depth, offset }
    })
}

export function fromMarkdownFile(filename: string, source: string, exportedTitle?: string, stripTitle = true) {
  const basename = filename.split(/[/\\]/).at(-1) ?? ''
  const title = exportedTitle ?? cleanTitle(basename.replace(/\.(?:md|markdown|mdown|txt)$/i, ''))
  const heading = /^\uFEFF?#\s+([^\r\n]+)\r?\n(?:\r?\n)?/.exec(source)
  return {
    title,
    markdown: stripTitle && heading && normalize(heading[1]) === normalize(title) ? source.slice(heading[0].length) : source,
  }
}

export function exportPage(page: Page) {
  if (page.frontmatter) {
    const separator = page.markdown && !page.frontmatter.endsWith('\n') ? '\n' : ''
    return page.frontmatter + separator + page.markdown
  }
  if (hasYamlFrontmatter(page.markdown)) return page.markdown
  if (page.properties && Object.keys(page.properties).length) {
    return `---\n${stringify(page.properties)}---\n${page.markdown}`
  }
  return `# ${page.title}\n\n${page.markdown}`
}
