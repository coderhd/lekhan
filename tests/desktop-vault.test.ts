import { describe, expect, it } from 'vitest'
import { prepareVaultSave, readMarkdownVault, type VaultSnapshot } from '../desktop/vault-storage'
import { createPage, updatePage } from '../lib/workspace'

function fixture(files: Record<string, string>, index: VaultSnapshot['index'] = null) {
  return readMarkdownVault({ index, sequence: 1, files: Object.entries(files).map(([path, text]) => ({ path, text, modifiedMs: 0 })) })
}

describe('desktop Markdown vault', () => {
  it('opens Obsidian notes directly and preserves untouched Markdown bytes and YAML', () => {
    const source = '---\r\ntags: [research]\r\n---\r\n# Outline\r\n\r\n[[Readme]]\r\n'
    const read = fixture({ 'Projects/Outline.md': source, 'Readme.md': '# Readme\n\nWelcome' })
    const outline = read.workspace.pages.find(page => page.title === 'Outline')!
    const parent = read.workspace.pages.find(page => page.title === 'Projects')!
    expect(outline.parentId).toBe(parent.id)
    expect(outline.properties).toEqual({ tags: ['research'] })
    const favorite = updatePage(read.workspace, outline.id, { favorite: true })
    const saved = prepareVaultSave(favorite, read, 0)
    expect(saved.changes).toEqual([])
    const updated = updatePage(favorite, outline.id, { markdown: 'Next steps\r\n' })
    expect(prepareVaultSave(updated, read, 0).desired.get('Projects/Outline.md'))
      .toBe('---\r\ntags: [research]\r\n---\r\n# Outline\r\n\r\nNext steps\r\n')
  })

  it('keeps stable page IDs across renamed and nested files', () => {
    const read = fixture({ 'Projects/Outline.md': '[[Outline]]', 'Projects.md': 'A parent note' })
    const parent = read.workspace.pages.find(page => page.title === 'Projects')!
    const child = read.workspace.pages.find(page => page.title === 'Outline')!
    expect(child.parentId).toBe(parent.id)
    const next = updatePage(read.workspace, parent.id, { title: 'Research' })
    const saved = prepareVaultSave(next, read, 0)
    expect([...saved.desired.keys()]).toEqual(['Research.md', 'Research/Outline.md'])
    const roundTrip = fixture(Object.fromEntries(saved.desired), saved.index)
    expect(roundTrip.workspace.pages.find(page => page.id === child.id)?.parentId).toBe(parent.id)
  })

  it('assigns safe distinct filenames while keeping editable titles', () => {
    const source = fixture({ 'One Other.md': 'Existing' })
    const next = createPage(source.workspace, { title: 'One ?Other', markdown: 'New' })
    const nextPage = next.pages.find(page => page.id === next.activePageId)!
    const saved = prepareVaultSave(next, source, 0)
    expect(saved.desired.get('One Other (2).md')).toBe('New')
    expect(fixture(Object.fromEntries(saved.desired), saved.index).workspace.pages.find(page => page.id === nextPage.id)?.title).toBe(nextPage.title)
  })
})
