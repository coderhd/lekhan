import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { makeWorkspaceArchive } from '../lib/workspace-export'
import type { Page, Workspace } from '../lib/types'
import { planVaultImport } from '../lib/vault-import'
import { readVaultZip } from '../lib/vault-reader'
import { applyVaultImport, resolvePage } from '../lib/workspace'

function page(id: string, title: string, parentId: string | null, markdown: string): Page {
  return { id, title, parentId, markdown, favorite: false, createdAt: '', updatedAt: '' }
}

const empty: Workspace = { activePageId: null, pages: [], revision: 0 }
const image = 'data:image/png;base64,iVBORw0KGgoBAg=='

describe('workspace Markdown export', () => {
  it('writes portable paths, rewrites resolved links and bundles each referenced image once', async () => {
    const pages = [
      page('child-a', 'Review', 'a', '[[Plan*2026#Scope|first]] · [[Review]] · [[Draft]]\n\n![Chart](' + image + ' "lekhan-size:180")'),
      page('child-b', 'Review', 'b', 'See [[Plan?2026/Review]] and `[[Plan*2026]]`.\n\n![[Plan*2026#Scope]] · ![[ Missing ]]\n\n![Same picture][chart]\n\n[chart]: <' + image + '>\n'),
      { ...page('a', 'Plan*2026', null, '## Scope\n\n> [!note]\n> Keep the original callout.'), frontmatter: '---\ntags: [plan]\n---\n' },
      page('b', 'Plan?2026', null, 'The second plan.'),
      page('top', 'Review', null, 'See [[/Review|this page]].'),
      page('draft', 'CON', null, 'Reserved Windows filename.'),
    ]
    const bytes = await makeWorkspaceArchive(pages)
    const files = unzipSync(bytes)
    expect(Object.keys(files).filter(path => path.endsWith('.png'))).toEqual(['Attachments/image-1.png'])
    expect(files['Attachments/image-1.png']).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]))
    expect(files['_CON.md']).toBeDefined()
    expect(strFromU8(files['Plan 2026/Review (2).md'])).toContain('[[Plan 2026#Scope|first]]')
    expect(strFromU8(files['Plan 2026/Review (2).md'])).toContain('[[Plan 2026/Review (2)|Review]]')
    expect(strFromU8(files['Plan 2026/Review (2).md'])).toContain('[[Draft]]')
    expect(strFromU8(files['Plan 2026/Review (2).md'])).toContain('![Chart](../Attachments/image-1.png "lekhan-size:180")')
    expect(strFromU8(files['Plan 2026 (2)/Review (2).md'])).toContain('`[[Plan*2026]]`')
    expect(strFromU8(files['Plan 2026.md'])).toBe(pages[2].frontmatter + pages[2].markdown)

    const plan = await planVaultImport(await readVaultZip(new File([new Uint8Array(bytes)], 'archive.zip')))
    const { workspace, report } = applyVaultImport(empty, plan)
    expect(report).toMatchObject({ notes: 6, folders: 0, images: 1 })
    expect(workspace.pages).toHaveLength(6)
    const first = workspace.pages.find(note => note.title === 'Plan*2026')!
    const second = workspace.pages.find(note => note.title === 'Plan?2026')!
    const firstReview = workspace.pages.find(note => note.parentId === first.id)!
    const secondReview = workspace.pages.find(note => note.parentId === second.id)!
    expect(first.properties).toEqual({ tags: ['plan'] })
    expect(firstReview.title).toBe('Review')
    expect(firstReview.markdown).toContain('![Chart](' + image + ' "lekhan-size:180")')
    expect(secondReview.markdown).toContain('[chart]: <' + image + '>')
    expect(secondReview.markdown).toContain('![[/Plan*2026#Scope|Plan*2026]] · ![[ Missing ]]')
    expect(resolvePage(workspace.pages, 'Plan?2026/Review', firstReview.id)).toBe(secondReview)
  })
  it('keeps a leading body heading and avoids file and folder collisions', async () => {
    const pages = [
      { ...page('root', 'Lab', null, '# Lab\n\nPreserve this heading.'), properties: { tags: ['work'] } },
      page('near', 'Lab.md', null, 'See [[Lab]] and [[Child]].'),
      page('nested', 'Child', 'near', '`![Literal](' + image + ')`'),
      { ...page('yaml', 'Draft', null, 'A later edit.'), frontmatter: '---\ntags: [draft]\n---' },
    ]
    const bytes = await makeWorkspaceArchive(pages)
    const files = unzipSync(bytes)
    expect(files['Lab.md']).toBeDefined()
    expect(files['Lab.md (2)/Child.md']).toBeDefined()
    expect(strFromU8(files['Lab.md (2)/Child.md'])).toContain(image)
    expect(Object.keys(files).filter(path => path.endsWith('.png'))).toEqual([])

    const plan = await planVaultImport(await readVaultZip(new File([new Uint8Array(bytes)], 'archive.zip')))
    const { workspace } = applyVaultImport(empty, plan)
    expect(workspace.pages).toHaveLength(4)
    expect(workspace.pages.find(note => note.title === 'Lab')).toMatchObject({
      markdown: pages[0].markdown, properties: { tags: ['work'] },
    })
    expect(workspace.pages.find(note => note.title === 'Draft')).toMatchObject({
      markdown: 'A later edit.', properties: { tags: ['draft'] },
    })
    expect(workspace.pages.find(note => note.title === 'Child')?.parentId)
      .toBe(workspace.pages.find(note => note.title === 'Lab.md')?.id)
  })

})
