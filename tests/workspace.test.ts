import { describe, expect, it } from 'vitest'
import type { Page, Workspace } from '../lib/types'
import {
  createPage, deletePage, exportPage, fromMarkdownFile, getBacklinks, notebookNavigation, pageChoices,
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
  it('reuses navigation and inbound links while writing, and updates them after structural edits', () => {
    const existing = workspace(page('a', 'Projects'), page('b', 'Draft', 'a'), page('c', 'Reference', null, 'See [[Draft]].'))
    const navigation = notebookNavigation(existing.pages)
    const inbound = getBacklinks(existing.pages, 'b')
    const edited = updatePage(existing, 'b', { markdown: 'Body with an outgoing [[Reference]] link.' })
    expect(notebookNavigation(edited.pages)).toBe(navigation)
    expect(getBacklinks(edited.pages, 'b')).toBe(inbound)
    expect(getBacklinks(edited.pages, 'c').map(link => link.page.id)).toEqual(['b'])

    const starred = updatePage(edited, 'b', { favorite: true })
    expect(notebookNavigation(starred.pages).favorites.map(item => item.id)).toEqual(['b'])
    const moved = updatePage(starred, 'b', { parentId: 'c', title: 'Outline' })
    const movedNavigation = notebookNavigation(moved.pages)
    expect(movedNavigation.path('b').map(item => item.title)).toEqual(['Reference', 'Outline'])
    expect(movedNavigation.childPages.get('a')).toBeUndefined()
    expect(getBacklinks(moved.pages, 'b').map(link => link.page.id)).toEqual(['c'])
    expect(notebookNavigation(deletePage(moved, 'c').pages).favorites).toEqual([])
  })

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

  it('skips folder containers when choosing the next active page after deletion', () => {
    const folder: Page = { ...page('folder', 'Vault'), folder: true }
    const child = page('child', 'Note', 'folder', 'Body')
    const other = page('other', 'Other', null, 'Elsewhere')
    expect(deletePage({ revision: 0, pages: [folder, child, other], activePageId: 'child' }, 'child').activePageId).toBe('other')
    expect(deletePage({ revision: 0, pages: [folder, child], activePageId: 'child' }, 'child').activePageId).toBeNull()
  })
})

describe('page links', () => {
  it('updates backlink targets and excerpts after editing a note and keeps paths current after a rename', () => {
    const existing = workspace(
      page('a', 'Projects'), page('b', 'Draft', 'a', 'See [[Notes|the old link]].'),
      page('c', 'Notes'), page('d', 'Archive'),
    )
    expect(getBacklinks(existing.pages, 'c').map(link => link.excerpt)).toEqual(['See the old link.'])
    const edited = updatePage(existing, 'b', { markdown: 'Open [[Archive|the new link]].', favorite: true })
    expect(getBacklinks(edited.pages, 'c')).toEqual([])
    expect(getBacklinks(edited.pages, 'd')).toEqual([{ page: edited.pages[1], excerpt: 'Open the new link.' }])
    expect(resolvePage(edited.pages, 'Projects/Draft')).toBe(edited.pages[1])
    expect(getBacklinks(existing.pages, 'c').map(link => link.excerpt)).toEqual(['See the old link.'])

    const renamed = updatePage(edited, 'a', { title: 'Ideas' })
    expect(resolvePage(renamed.pages, 'Projects/Draft')).toBeUndefined()
    expect(resolvePage(renamed.pages, 'Ideas/Draft')).toBe(renamed.pages[1])
    expect(pageChoices(renamed.pages).find(choice => choice.id === 'b')?.path).toBe('Ideas/Draft')
    expect(getBacklinks(renamed.pages, 'd').map(link => link.excerpt)).toEqual(['Open the new link.'])
  })

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
