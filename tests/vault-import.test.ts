import { describe, expect, it } from 'vitest'
import { applyVaultImport, getBacklinks, notebookNavigation, searchPages, exportPage } from '../lib/workspace'
import { planVaultImport } from '../lib/vault-import'
import type { Workspace } from '../lib/types'

const data = (text: string) => new TextEncoder().encode(text)
const empty: Workspace = { activePageId: null, pages: [], revision: 0 }

describe('vault import into the page graph', () => {
  it('keeps nesting, metadata, image bytes, aliases and links to a retitled page', async () => {
    const planned = await planVaultImport({
      files: [
        { path: 'Library/Start.md', data: data('[[Guide/First#Scope|the guide]]\n\n![[stamp.png|180]]\n\n`![[stamp.png]]`\n\n![[Missing]]') },
        { path: 'Library/Guide/First.md', data: data('---\ntitle: First steps\ntags: [launch]\nrating: 5\n---\n\n## Scope\n\nA note.') },
        { path: 'Library/stamp.png', data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]) },
      ],
      directories: ['Library', 'Library/Guide', 'Empty'],
    })
    const { workspace, report } = applyVaultImport(empty, planned)
    const first = workspace.pages.find(page => page.title === 'First steps')!
    const start = workspace.pages.find(page => page.title === 'Start')!
    const library = workspace.pages.find(page => page.title === 'Library')!
    const guide = workspace.pages.find(page => page.title === 'Guide')!
    const emptyFolder = workspace.pages.find(page => page.title === 'Empty')!
    expect(library.folder).toBe(true)
    expect(guide.folder).toBe(true)
    expect(emptyFolder.folder).toBe(true)
    expect(start.folder).toBeUndefined()
    expect(workspace.activePageId).toBe(first.id)
    expect(first.folder).toBeUndefined()
    expect(notebookNavigation(workspace.pages).childPages.get(null)?.find(item => item.id === library.id)?.folder).toBe(true)
    expect(workspace.pages.find(page => page.id === first.parentId)?.title).toBe('Guide')
    expect(workspace.pages.some(page => page.title === 'Empty')).toBe(true)
    expect(first.properties).toMatchObject({ title: 'First steps', tags: ['launch'], rating: 5 })
    expect(searchPages(workspace.pages, 'launch')).toContain(first)
    expect(exportPage(first)).toMatch(/^---\ntitle: First steps\n/)
    expect(start.markdown).toContain('[[Library/Guide/First steps#Scope|the guide]]')
    expect(start.markdown).toMatch(/data:image\/png;base64,/)
    expect(start.markdown).toContain('`![[stamp.png]]`')
    expect(getBacklinks(workspace.pages, first.id)).toEqual([expect.objectContaining({ page: start })])
    expect(report).toMatchObject({ notes: 2, folders: 3, images: 1, resolved: 1, unresolved: 1, degraded: 1 })
    expect(applyVaultImport(workspace, planned)).toMatchObject({ workspace, report: { repeated: true } })
  })

  it('refuses archives without notes and leaves unsupported attachments as reported links', async () => {
    await expect(planVaultImport({ files: [], directories: ['Empty'] })).rejects.toThrow('No Markdown notes')
    const plan = await planVaultImport({
      files: [{ path: 'Index.md', data: data('![[unsafe.svg]]') }, { path: 'unsafe.svg', data: data('<svg/>') }],
      directories: [],
    })
    const { workspace, report } = applyVaultImport(empty, plan)
    expect(workspace.pages[0].markdown).toBe('[[unsafe.svg]]')
    expect(report).toMatchObject({ degraded: 1, unresolved: 1, images: 0 })
  })
})
