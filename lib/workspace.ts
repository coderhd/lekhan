import type { Page, PageChoice, Workspace } from './types'

type PageInput = Partial<Pick<Page, 'title' | 'parentId' | 'markdown'>>
type PagePatch = PageInput & Partial<Pick<Page, 'favorite'>>

interface WikiLink {
  start: number
  end: number
  target: string
  alias: string | undefined
}

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

export function pagePath(pages: Page[], id: string) {
  return pathFromMap(new Map(pages.map((page) => [page.id, page])), id)
}

function buildResolver(pages: Page[]) {
  const pagesById = new Map(pages.map((page) => [page.id, page]))
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

  return { canonicalPath, resolveTarget }
}

export function resolvePage(pages: Page[], target: string, sourceId?: string) {
  return buildResolver(pages).resolveTarget(target, sourceId)
}

export function pageChoices(pages: Page[]): PageChoice[] {
  const { canonicalPath } = buildResolver(pages)
  return pages.map((page) => ({ id: page.id, title: page.title, path: canonicalPath(page) }))
}

function proseRanges(markdown: string): { start: number; end: number }[] {
  const ranges = []
  let fence: string | undefined
  let indentedCode = false
  let startsParagraph = true
  let listIndent = 0
  let start = 0
  let end = 0

  for (const line of markdown.split('\n')) {
    const offset = end
    end += line.length + 1
    const unquoted = line.replace(/^(?: {0,3}>[ \t]?)+/, '')
    const blank = !unquoted.trim()
    const spaces = /^[ \t]*/.exec(unquoted)?.[0].replace(/\t/g, '    ').length ?? 0
    const relativeIndent = spaces >= listIndent ? spaces - listIndent : spaces
    const marker = /^(`{3,}|~{3,})([^\n]*)/.exec(unquoted.trimStart())

    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = undefined
      }
      start = end
      continue
    }

    if (!blank && spaces < listIndent) listIndent = 0
    const isIndentedCode: boolean = (indentedCode && blank) || ((indentedCode || startsParagraph) && relativeIndent >= 4)
    const opensFence = relativeIndent < 4 && marker && !(marker[1][0] === '`' && marker[2].includes('`'))

    if (blank || isIndentedCode || opensFence) {
      if (offset > start) ranges.push({ start, end: offset })
      start = end
    }
    if (opensFence) fence = marker[1]
    indentedCode = isIndentedCode
    startsParagraph = blank || Boolean(opensFence) || isIndentedCode

    const listMarker = /^( *)(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(unquoted)
    if (listMarker) listIndent = listMarker[0].length
  }
  if (start < markdown.length) ranges.push({ start, end: markdown.length })
  return ranges
}

function escaped(text: string, offset: number) {
  let previous = offset - 1
  while (previous >= 0 && text[previous] === '\\') previous--
  return (offset - previous) % 2 === 0
}

function wikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = []
  const pattern = /(?<code>`+)|\[\[(?<target>[^|\]\r\n]+)(?:\|(?<alias>[^\]\r\n]+))?\]\]/g

  for (const { start, end } of proseRanges(markdown)) {
    const prose = markdown.slice(start, end)
    pattern.lastIndex = 0
    for (let match = pattern.exec(prose); match; match = pattern.exec(prose)) {
      const groups = match.groups
      if (!groups || escaped(prose, match.index)) continue
      if (groups.code) {
        const delimiter = /`+/g
        delimiter.lastIndex = pattern.lastIndex
        for (let closing = delimiter.exec(prose); closing; closing = delimiter.exec(prose)) {
          if (closing[0].length === groups.code.length) {
            pattern.lastIndex = delimiter.lastIndex
            break
          }
        }
        continue
      }
      const target = groups.target?.trim()
      if (!target || prose[match.index - 1] === '!') continue
      links.push({ target, alias: groups.alias, start: start + match.index, end: start + pattern.lastIndex })
    }
  }
  return links
}

function keepResolvedLinks(previous: Page[], next: Page[], now: string) {
  const before = buildResolver(previous)
  const after = buildResolver(next)
  const oldIds = new Set(previous.map((page) => page.id))
  const newPagesById = new Map(next.map((page) => [page.id, page]))
  return next.map((page) => {
    if (!oldIds.has(page.id)) return page
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

export function createPage(workspace: Workspace, input: PageInput = {}): Workspace {
  const { pages } = workspace
  const parentId = pages.some((page) => page.id === input.parentId) ? input.parentId ?? null : null
  const now = new Date().toISOString()
  const page: Page = {
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    parentId,
    title: uniqueTitle(pages, parentId, input.title ?? 'Untitled'),
    markdown: input.markdown ?? '',
    favorite: false,
    createdAt: now,
    updatedAt: now,
  }
  return { ...workspace, pages: keepResolvedLinks(pages, [...pages, page], now), activePageId: page.id }
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
    const link = wikiLinks(page.markdown).find(({ target }) => resolveTarget(target, page.id)?.id === id)
    if (!link) return []
    const lineStart = page.markdown.lastIndexOf('\n', Math.max(0, link.start - 1)) + 1
    const lineBreak = page.markdown.indexOf('\n', link.end)
    const lineEnd = lineBreak < 0 ? page.markdown.length : lineBreak
    const line = page.markdown.slice(lineStart, lineEnd).trim()
    const excerpt = line.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias ?? target.split('/').at(-1))
    return [{ page, excerpt: excerpt.length > 155 ? `${excerpt.slice(0, 152).trimEnd()}…` : excerpt }]
  })
}

export function searchPages(pages: Page[], query: string): Page[] {
  const term = normalize(query)
  const terms = term.split(/\s+/)
  const ranked = pages.map((page) => {
    const title = normalize(page.title)
    const body = normalize(page.markdown)
    if (!term) return { page, score: 1 }
    if (title === term) return { page, score: 5 }
    if (title.startsWith(term)) return { page, score: 4 }
    if (title.includes(term)) return { page, score: 3 }
    if (terms.every((word) => title.includes(word) || body.includes(word))) return { page, score: 2 }

    let matched = 0
    for (const character of title) {
      if (character === term[matched]) matched++
    }
    return { page, score: matched === term.length ? 1 : 0 }
  })

  return ranked.filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.page.updatedAt.localeCompare(left.page.updatedAt))
    .map(({ page }) => page)
}

export function pageHeadings(markdown: string): { text: string; level: number }[] {
  return proseRanges(markdown).flatMap(({ start, end }) => {
    const lines = markdown.slice(start, end).split(/\r?\n/)
    const headings = []
    for (let i = 0; i < lines.length; i++) {
      const heading = /^ {0,3}(#{1,6})[ \t]+(.+)$/.exec(lines[i])
      if (heading) {
        headings.push({ level: heading[1].length, text: heading[2].replace(/[ \t]+#+[ \t]*$/, '').trim() })
        continue
      }
      const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[i + 1] ?? '')
      if (underline && /^ {0,3}[^\s#>*+-]/.test(lines[i])) {
        headings.push({ level: underline[1][0] === '=' ? 1 : 2, text: lines[i].trim() })
        i++
      }
    }
    return headings
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
  return `# ${page.title}\n\n${page.markdown}`
}
