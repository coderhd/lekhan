import type { Page } from './types'
import { escaped, proseRanges, wikiLinks } from './markdown-references'

export interface SearchHit {
  page: Page
  surface: 'title' | 'tag' | 'link' | 'content'
  context?: string
}

type Field = { text: string; key: string }
interface SearchRecord {
  page: Page
  title: string
  tags: Field[]
  targets: Field[]
  content: Field
}

const recordsByPage = new WeakMap<Page, SearchRecord>()
const indexesBySnapshot = new WeakMap<Page[], WorkspaceSearchIndex>()
const normalize = (value: string) => value.trim().normalize('NFC').toLowerCase()
const field = (text: string): Field => ({ text, key: normalize(text) })

const hashtag = /(?:^|[\s(,;])#([\p{L}\p{M}\p{N}_/-]*[\p{L}\p{M}_/-][\p{L}\p{M}\p{N}_/-]*)/gu

export function pageTags(page: Page): string[] {
  const tags = new Map<string, string>()
  function add(value: unknown) {
    if (typeof value !== 'string') return
    const tag = value.trim().replace(/^#/, '')
    if (!tag || !/[\p{L}\p{M}_/-]/u.test(tag) || !/^[\p{L}\p{M}\p{N}_/-]+$/u.test(tag)) return
    const key = normalize(tag)
    if (!tags.has(key)) tags.set(key, tag)
  }

  const metadata = page.properties?.tags
  if (Array.isArray(metadata)) for (const tag of metadata) add(tag)
  else if (typeof metadata === 'string') {
    for (const tag of metadata.split(/[,\s]+/)) add(tag)
  }

  for (const { start, end } of proseRanges(page.markdown)) {
    const prose = page.markdown.slice(start, end).replace(/(`+)([^\r\n]*?)\1/g, match => ' '.repeat(match.length))
    hashtag.lastIndex = 0
    for (const match of prose.matchAll(hashtag)) {
      const prefix = match[0].indexOf('#')
      if (!escaped(prose, match.index + prefix)) add(match[1])
    }
  }
  return [...tags.values()]
}

function searchRecord(page: Page) {
  const cached = recordsByPage.get(page)
  if (cached) return cached

  const record: SearchRecord = {
    page,
    title: normalize(page.title),
    tags: pageTags(page).map(tag => field('#' + tag)),
    targets: wikiLinks(page.markdown).map(link => field(link.target)),
    content: field(page.markdown
      .replace(/data:image\/[a-z-]+;base64,[a-z0-9+/=]+/gi, '')
      .replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target)
      .replace(/\s+/g, ' ')),
  }
  recordsByPage.set(page, record)
  return record
}

function trigrams(value: string) {
  const terms = new Set<string>()
  for (let index = 0; index + 3 <= value.length; index++) terms.add(value.slice(index, index + 3))
  return terms
}

function excerpt(body: Field, term: string) {
  const start = Math.max(0, body.key.indexOf(term) - 24)
  return (start ? '…' : '') + body.text.slice(start, start + 85).trim() + (body.text.length > start + 85 ? '…' : '')
}

class WorkspaceSearchIndex {
  private readonly records: SearchRecord[]
  private readonly postings = new Map<string, number[]>()

  constructor(pages: Page[]) {
    this.records = pages.map(searchRecord)
    for (const [id, record] of this.records.entries()) {
      const keys = [record.title, ...record.tags.map(tag => tag.key), ...record.targets.map(link => link.key), record.content.key]
      const grams = new Set<string>()
      for (const key of keys) for (const term of trigrams(key)) grams.add(term)
      for (const gram of grams) {
        const matches = this.postings.get(gram)
        if (matches) matches.push(id)
        else this.postings.set(gram, [id])
      }
    }
  }

  query(input: string, limit = 15): SearchHit[] {
    const term = normalize(input)
    const ranked: (SearchHit & { score: number })[] = []
    const push = (record: SearchRecord, surface: SearchHit['surface'], score: number, context?: string) => {
      ranked.push({ page: record.page, surface, score, context })
    }
    const words = term.split(/\s+/)
    const grams = words.flatMap(word => [...trigrams(word)])
    const leastFrequent = grams.reduce<number[] | undefined>((best, gram) => {
      const matches = this.postings.get(gram) ?? []
      return best === undefined || matches.length < best.length ? matches : best
    }, undefined)
    const candidates = leastFrequent === undefined ? this.records : leastFrequent.map(id => this.records[id])

    for (const record of candidates) {
      if (!term) push(record, 'title', 1)
      else if (record.title === term) push(record, 'title', 6)
      else if (record.title.startsWith(term)) push(record, 'title', 5)
      else if (record.title.includes(term)) push(record, 'title', 4)
      else {
        const tag = record.tags.find(item => item.key.includes(term))
        const link = record.targets.find(item => item.key.includes(term))
        if (tag) push(record, 'tag', 3, tag.text)
        else if (link) push(record, 'link', 2, '[[' + link.text + ']]')
        else if (words.every(word => record.title.includes(word) || record.content.key.includes(word))) {
          push(record, 'content', 1, excerpt(record.content, record.content.key.includes(term) ? term : words[0]))
        }
      }
    }

    if (term && ranked.length < limit) {
      const matched = new Set(ranked.map(hit => hit.page.id))
      for (const record of this.records) {
        if (matched.has(record.page.id)) continue
        let offset = 0
        for (const character of record.title) if (character === term[offset]) offset++
        if (offset === term.length) push(record, 'title', 0)
      }
    }

    return ranked.sort((left, right) => right.score - left.score || right.page.updatedAt.localeCompare(left.page.updatedAt)).slice(0, limit)
      .map(({ page, surface, context }) => ({ page, surface, context }))
  }
}

export function workspaceSearch(pages: Page[]) {
  let index = indexesBySnapshot.get(pages)
  if (!index) {
    index = new WorkspaceSearchIndex(pages)
    indexesBySnapshot.set(pages, index)
  }
  return index
}

export function searchPages(pages: Page[], query: string) {
  return workspaceSearch(pages).query(query, pages.length).map(result => result.page)
}
