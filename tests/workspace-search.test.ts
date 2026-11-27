import { describe, expect, it } from 'vitest'
import { pageTags, workspaceSearch } from '../lib/workspace-search'
import type { Page } from '../lib/types'

function note(id: string, title: string, markdown: string, tags: string[] = []): Page {
  return { id, title, markdown, properties: { tags }, parentId: null, favorite: false, createdAt: '2026-11-21', updatedAt: '2026-11-21' }
}

describe('workspace search index', () => {
  it('ranks title, tag, link, and body matches in the specified order', () => {
    const pages = [
      note('body', 'Journal', 'The compass pointed north'),
      note('link', 'Meeting', 'Read [[Compass|these notes]]'),
      note('tag', 'Tasks', 'A body of text.', ['Compass']),
      note('title', 'Compass', 'Description.'),
    ]
    const hits = workspaceSearch(pages).query('compass')
    expect(hits.map(({ page, surface }) => [page.id, surface])).toEqual([
      ['title', 'title'], ['tag', 'tag'], ['link', 'link'], ['body', 'content'],
    ])
    expect(hits[1].context).toBe('#Compass')
    expect(hits[2].context).toBe('[[Compass]]')
  })

  it('combines property and prose tags while keeping code and numeric markers out of the tag index', () => {
    const page = note('a', 'Research', '# Section\n\nUse #Café and #café. `#skip` #123\n\n~~~\n#ignored\n~~~', ['Design', '#design'])
    expect(pageTags(page)).toEqual(['Design', 'Café'])
  })

  it('uses index snapshots so page edits and deletes are visible on the next query', () => {
    const old = [note('a', 'Archive', 'Unicorns'), note('b', 'Tasks', '#spring')]
    expect(workspaceSearch(old).query('unicorns').map(hit => hit.page.id)).toEqual(['a'])
    const edited = [{ ...old[0], markdown: 'Comets and stars' }]
    expect(workspaceSearch(edited).query('unicorns')).toEqual([])
    expect(workspaceSearch(edited).query('#spring')).toEqual([])
    expect(workspaceSearch(edited).query('comets stars').map(hit => hit.page.id)).toEqual(['a'])
  })
})
