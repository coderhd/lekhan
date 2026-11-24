import { lexer, type Token, type Tokens } from 'marked'
import type { Page, PageChoice, Workspace } from './types'
import { wikiLinks } from './markdown-references'
export { searchPages } from './workspace-search'
import { hasYamlFrontmatter } from './markdown'
import type { ImportReport, VaultImportPlan } from './vault-import'

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

function pathFromMap(pages: Map<string, Page>, id: string) {
  const path: Page[] = []
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
  canonicalPath: (page: Page, explicit?: boolean) => string
  resolveTarget: (target: string, sourceId?: string) => Page | undefined
}
const resolversBySnapshot = new WeakMap<Page[], PageResolver>()
const linksByPage = new WeakMap<Page, ReturnType<typeof wikiLinks>>()

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
  const pagesById = pageIndex(pages)
  const pathsById = new Map(pages.map((page) => [page.id, pathFromMap(pagesById, page.id)]))
  const byPath = new Map<string, Page>()
  const byTitle = new Map<string, Page[]>()

  for (const page of pages) {
    const title = normalize(page.title)
    const sameTitlePages = byTitle.get(title) ?? []
    sameTitlePages.push(page)
    byTitle.set(title, sameTitlePages)
    const path = pathsById.get(page.id)?.map((item) => normalize(item.title)).join('/')
    if (path) byPath.set(path, page)
  }

  function canonicalPath(page: Page, explicit = false) {
    const path = pathsById.get(page.id)?.map(({ title }) => title).join('/') ?? page.title
    const ambiguousRootTitle = (byTitle.get(normalize(page.title))?.length ?? 0) > 1
    return !page.parentId && (explicit || ambiguousRootTitle) ? `/${path}` : path
  }

  function resolveTarget(target: string, sourceId?: string): Page | undefined {
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

    let best: Page | undefined
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

  const resolver = { canonicalPath, resolveTarget }
  resolversBySnapshot.set(pages, resolver)
  return resolver
}

export function resolvePage(pages: Page[], target: string, sourceId?: string) {
  return buildResolver(pages).resolveTarget(target, sourceId)
}

export function pageChoices(pages: Page[]): PageChoice[] {
  const { canonicalPath } = buildResolver(pages)
  return pages.map((page) => ({ id: page.id, title: page.title, path: canonicalPath(page) }))
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

export function applyVaultImport(workspace: Workspace, plan: VaultImportPlan): { workspace: Workspace; report: ImportReport } {
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
  for (const folder of plan.directories) {
    const title = folder.split('/').at(-1) ?? folder
    const created = newPage(pages, { title }, folders.get(directoryOf(folder)) ?? null, now)
    pages.push(created)
    folders.set(folder, created.id)
  }

  const importedNotes = plan.notes.map(note => {
    const page = newPage(pages, note, folders.get(directoryOf(note.sourcePath)) ?? null, now)
    pages.push(page)
    return { note, page }
  })
  const firstPageId = importedNotes[0].page.id
  const { canonicalPath, resolveTarget } = buildResolver(pages)
  const pathWithoutExtension = (path: string) => normalize(path).replace(/\.(md|markdown)$/i, '')
  const notePaths = new Map(importedNotes.map(({ note, page }) => [pathWithoutExtension(note.sourcePath), page]))
  const images = new Map([...plan.images].map(([path, data]) => [normalize(path), data]))
  const usedImages = new Set<string>()
  const report: ImportReport = {
    notes: importedNotes.length, folders: folders.size, images: 0,
    resolved: 0, unresolved: 0, degraded: 0, invalidProperties: plan.invalidProperties,
  }
  let outputSize = 0
  for (const { page, note } of importedNotes) {
    let body = ''
    let cursor = 0
    for (const link of wikiLinks(note.markdown, true)) {
      const [path] = link.target.split('#', 1)
      const anchor = link.target.slice(path.length)
      const picture = link.embed ? findVaultTarget(images, path, note.sourcePath) : undefined
      body += note.markdown.slice(cursor, link.start)
      if (picture) {
        usedImages.add(picture)
        const label = path.split('/').at(-1)?.replace(/[\[\]\\]/g, '') || 'Imported image'
        const width = /^\d{1,4}(?:x\d{1,4})?$/.test(link.alias ?? '') ? ' "lekhan-size:' + link.alias + '"' : ''
        body += '![' + label + '](' + picture + width + ')'
      } else {
        if (link.embed) report.degraded++
        const target = findVaultTarget(notePaths, pathWithoutExtension(path), note.sourcePath)
          ?? resolveTarget(link.target, page.id)
        if (target) report.resolved++
        else report.unresolved++
        const parsedTarget = target && path ? canonicalPath(target, true) + anchor : link.target
        body += '[[' + parsedTarget + (link.alias === undefined ? '' : '|' + link.alias) + ']]'
      }
      if (outputSize + body.length > 140_000_000) throw new Error('Embedded images make this vault too large to import.')
      cursor = link.end
    }
    page.markdown = body + note.markdown.slice(cursor)
    outputSize += page.markdown.length
    if (outputSize > 140_000_000) throw new Error('Embedded images make this vault too large to import.')
  }
  report.images = usedImages.size
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
  const page = workspace.pages.find((current) => current.id === id)
  if (!page) return workspace
  const parentId = patch.parentId === undefined ? page.parentId : patch.parentId
  if (parentId) {
    const targetPath = pagePath(workspace.pages, parentId)
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
  const pages = workspace.pages.map((current) => current.id === id ? updated : current)
  return { ...workspace, pages: metadataChanged ? keepResolvedLinks(workspace.pages, pages, now) : pages }
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
  const { resolveTarget } = buildResolver(pages)
  return pages.flatMap((page) => {
    if (page.id === id) return []
    let references = linksByPage.get(page)
    if (!references) {
      references = wikiLinks(page.markdown)
      linksByPage.set(page, references)
    }
    const link = references.find(({ target }) => resolveTarget(target, page.id)?.id === id)
    if (!link) return []
    const lineStart = page.markdown.lastIndexOf('\n', Math.max(0, link.start - 1)) + 1
    const lineBreak = page.markdown.indexOf('\n', link.end)
    const lineEnd = lineBreak < 0 ? page.markdown.length : lineBreak
    const line = page.markdown.slice(lineStart, lineEnd).trim()
    const excerpt = line.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias ?? target.split('/').at(-1))
    return [{ page, excerpt: excerpt.length > 155 ? `${excerpt.slice(0, 152).trimEnd()}…` : excerpt }]
  })
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

export function fromMarkdownFile(filename: string, source: string) {
  const basename = filename.split(/[/\\]/).at(-1) ?? ''
  const title = cleanTitle(basename.replace(/\.(?:md|markdown|mdown|txt)$/i, ''))
  const heading = /^\uFEFF?#\s+([^\r\n]+)\r?\n(?:\r?\n)?/.exec(source)
  return {
    title,
    markdown: heading && normalize(heading[1]) === normalize(title) ? source.slice(heading[0].length) : source,
  }
}

export function exportPage(page: Page) {
  if (page.frontmatter) return page.frontmatter + page.markdown
  return hasYamlFrontmatter(page.markdown) ? page.markdown : `# ${page.title}\n\n${page.markdown}`
}
