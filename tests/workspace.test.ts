import { describe, expect, it } from 'vitest'
import type { Page, Workspace } from '../lib/types'
import {
  createPage, deletePage, exportPage, fromMarkdownFile, getBacklinks, pageChoices,
  pageHeadings, pagePath, resolvePage, searchPages, updatePage,
} from '../lib/workspace'

function page(id: string, title: string, parentId: string | null = null, markdown = ''): Page {
  return {
    id, title, parentId, markdown, favorite: false,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

function workspace(...pages: Page[]): Workspace {
  return { revision: 0, pages, activePageId: pages[0]?.id ?? null }
}

describe('page hierarchy', () => {
  it('creates and selects a child with a unique title', () => {
    const existing = workspace(page('a', 'Projects'), page('b', 'Untitled', 'a'))
    const result = createPage(existing, { parentId: 'a' })
    expect(result.pages.at(-1)).toMatchObject({ id: result.activePageId, title: 'Untitled 2', parentId: 'a' })
    expect(existing.pages).toHaveLength(2)
    expect(pagePath(result.pages, result.activePageId!).map(({ title }) => title)).toEqual(['Projects', 'Untitled 2'])
  })

  it('rejects moving a page into its descendants', () => {
    const existing = workspace(page('a', 'Projects'), page('b', 'Paper', 'a'))
    expect(updatePage(existing, 'a', { parentId: 'b' })).toBe(existing)
  })

  it('deletes a complete subtree and selects an available page', () => {
    const outside = page('c', 'Inbox')
    const existing = workspace(page('a', 'Projects'), page('b', 'Paper', 'a'), outside)
    expect(deletePage({ ...existing, activePageId: 'b' }, 'a')).toEqual({
      ...existing, pages: [outside], activePageId: 'c',
    })
  })
})

describe('page links', () => {
  it('resolves canonical paths and prefers the nearest unqualified match', () => {
    const pages = [
      page('a', 'Projects'), page('b', 'Reference'),
      page('c', 'Notes', 'a'), page('d', 'Notes', 'b'), page('e', 'Draft', 'b'),
    ]
    expect(resolvePage(pages, 'Notes', 'e')?.id).toBe('d')
    expect(resolvePage(pages, 'Notes')).toBeUndefined()
    expect(resolvePage(pages, 'projects/notes', 'e')?.id).toBe('c')
    expect(pageChoices(pages).find(({ id }) => id === 'c')?.path).toBe('Projects/Notes')
  })

  it('preserves explicit root targets when a closer page shares the title', () => {
    const pages = [
      page('a', 'Notes'), page('b', 'Reference'), page('c', 'Notes', 'b'), page('d', 'Draft', 'b'),
    ]
    const rootChoice = pageChoices(pages).find(({ id }) => id === 'a')!
    expect(resolvePage(pages, rootChoice.path, 'd')?.id).toBe('a')
    expect(resolvePage(pages, 'Notes', 'd')?.id).toBe('c')
  })

  it('repairs affected path links on ancestor rename and keeps explicit labels', () => {
    const existing = workspace(
      page('a', 'Projects'),
      page('b', 'Paper', 'a'),
      page('c', 'Inbox', null, 'See [[Projects/Paper#Overview|the outline]] or [[Paper]].'),
    )
    const updated = updatePage(existing, 'a', { title: 'Archive' })
    expect(updated.pages[2]?.markdown).toBe('See [[Archive/Paper#Overview|the outline]] or [[Paper]].')
    expect(getBacklinks(updated.pages, 'b').map(({ page }) => page.id)).toEqual(['c'])
  })

  it('keeps prior targets when a move makes short links resolve to a different page', () => {
    const existing = workspace(
      page('a', 'Projects'), page('b', 'Reference'),
      page('c', 'Notes', 'a'), page('d', 'Notes', 'b'),
      page('e', 'Draft', 'b', 'Read [[Notes]].'),
    )
    const updated = updatePage(existing, 'e', { parentId: 'a' })
    expect(updated.pages[4]?.markdown).toBe('Read [[Reference/Notes]].')
  })

  it('ignores links in code, images and escaped openers when deriving backlinks', () => {
    const pages = [
      page('a', 'Target'),
      page('b', 'Examples', null, '\\[[Target]]\n![[Target]]\n`[[Target]]`\n\n~~~md\n[[Target]]\n~~~'),
      page('c', 'Memo', null, 'A reference to [[Target|the page]] in context.'),
    ]
    expect(getBacklinks(pages, 'a')).toEqual([{ page: pages[2], excerpt: 'A reference to the page in context.' }])
  })

  it('treats backticks in different paragraphs as separate literal text', () => {
    const pages = [
      page('a', 'Target'),
      page('b', 'Memo', null, 'A literal ` in this paragraph.\n\n[[Target]] appears in another.\n\nA literal ` in a third.'),
    ]
    expect(getBacklinks(pages, 'a').map(({ page }) => page.id)).toEqual(['b'])
  })

  it('does not count wikilinks in an indented code block', () => {
    const pages = [page('a', 'Target'), page('b', 'Memo', null, 'An example:\n\n    [[Target]]')]
    expect(getBacklinks(pages, 'a')).toEqual([])
  })

  it('does not redirect an explicit root link when adding a duplicate in the source branch', () => {
    const existing = workspace(
      page('a', 'Notes'), page('b', 'Reference'),
      page('c', 'Draft', 'b', 'Read [[Notes]].'),
    )
    const updated = createPage(existing, { title: 'Notes', parentId: 'b' })
    expect(getBacklinks(updated.pages, 'a').map(({ page }) => page.id)).toEqual(['c'])
  })
})

describe('page content', () => {
  it('ranks title matches before body matches', () => {
    const pages = [
      page('a', 'Projects', null, 'Research on the next release.'),
      page('b', 'Research Methods'),
      page('c', 'Overview'),
    ]
    expect(searchPages(pages, 'research').map(({ id }) => id)).toEqual(['b', 'a'])
  })

  it('extracts headings while ignoring fenced code and removes closing hashes', () => {
    const markdown = '## Brief ##\n\n```md\n# Example\n```\n   ### Details\n\nConclusion\n----------'
    expect(pageHeadings(markdown).map(({ text, level }) => ({ text, level }))).toEqual([
      { text: 'Brief', level: 2 },
      { text: 'Details', level: 3 },
      { text: 'Conclusion', level: 2 },
    ])
  })

  it('keeps YAML metadata at the very start of the Markdown export', () => {
    const source = '---\ntags: [writing]\n---\n\nA paragraph.'
    expect(exportPage(page('a', 'Writing', null, source))).toBe(source)
  })

  it('preserves Markdown on import and avoids duplicating an exported title', () => {
    const original = '## Ideas\n\n- [ ] Refer to [[Related]].\n'
    const exported = exportPage(page('a', 'My Notes', null, original))
    expect(fromMarkdownFile('My Notes.md', exported)).toEqual({ title: 'My Notes', markdown: original })
    expect(fromMarkdownFile('Imported.markdown', '# Existing title\n\nBody')).toEqual({
      title: 'Imported', markdown: '# Existing title\n\nBody',
    })
  })
})
