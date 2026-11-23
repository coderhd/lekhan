import { describe, expect, it } from 'vitest'
import { attachmentMarkdown, rebaseAttachmentReferences, referencedAttachments } from '../desktop/vault-attachments'

import { prepareVaultSave, readMarkdownVault, rebaseVaultWorkspace } from '../desktop/vault-storage'
import { updatePage } from '../lib/workspace'

const assets = ['Pictures/Beach photo.png', 'Notes/map.png', 'Pictures/map.png', 'Files/report.pdf',
  'Hidden/.private.png', 'Files/Handout (new).pdf'].map(path => ({ path, bytes: 20, modifiedMs: 0 }))

describe('desktop attachment references', () => {
  it('resolves Obsidian embeds and Markdown downloads without exposing remote or hidden files', () => {
    const markdown = [
      '![[Beach photo.png|250]]',
      '![[map.png|A local map]]',
      '[Meeting packet](../Files/report.pdf)',
      '[Hidden](../Hidden/.private.png)',
      '[Outside](../../Files/report.pdf)',
      '[Foreign](https://other.example/Files/report.pdf)',
      '`![[report.pdf]]`',
      '```md\n![[Handout (new).pdf]]\n```',
    ].join('\n\n')
    expect(referencedAttachments(markdown, 'Notes/Plan.md', assets).map(({ path, preview, label }) => [path, preview, label]))
      .toEqual([
        ['Pictures/Beach photo.png', true, 'Beach photo.png'],
        ['Notes/map.png', true, 'A local map'],
        ['Files/report.pdf', false, 'Meeting packet'],
      ])
  })

  it('keeps ambiguous basenames unresolved and emits portable links for new attachments', () => {
    expect(referencedAttachments('![[map.png]]', 'Plan.md', assets)).toEqual([])
    const markdown = attachmentMarkdown('Files/Handout (new).pdf', 'Notes/Deep/Plan.md')
    expect(referencedAttachments(markdown, 'Notes/Deep/Plan.md', assets).map(asset => asset.path))
      .toEqual(['Files/Handout (new).pdf'])
  })
  it('rewrites only destination spans and preserves definitions, labels, query strings and code', () => {
    const additional = [...assets, { path: 'Notes/Deep/map.png', modifiedMs: 0, bytes: 20 }]
    const catalog = new Map(additional.map(asset => [asset.path, asset]))
    const before = [
      '\uFEFF---',
      'caption: "[Keep](../Files/report.pdf)"',
      '---',
      '> ![Beach](<../Pictures/Beach%20photo.png> "Taken on holiday")',
      '> [Details][report]',
      '',
      '[report]: ../Files/report.pdf?download=1#page=2 "Meeting notes"',
      '![[map.png#detail|250x100]]',
      '[Unchanged](/Files/report.pdf)',
      '',
      '`[Code](../Files/report.pdf)`',
      '',
      '```md',
      '[Example](../Files/report.pdf)',
      '```',
    ].join('\r\n')
    const rewritten = rebaseAttachmentReferences(before, 'Notes/Plan.md', 'Notes/Deep/Plan.md', catalog)
    expect(rewritten).toBe(before
      .replace('<../Pictures/Beach%20photo.png>', '<../../Pictures/Beach%20photo.png>')
      .replace('[report]: ../Files/', '[report]: ../../Files/')
      .replace('![[map.png#detail|250x100]]', '![[/Notes/map.png#detail|250x100]]'))
    expect(referencedAttachments(rewritten, 'Notes/Deep/Plan.md', additional).map(asset => asset.path))
      .toEqual(['Notes/map.png', 'Pictures/Beach photo.png', 'Files/report.pdf'])
  })

  it('preserves a working relative link when moving between sibling folders', () => {
    const catalog = new Map(assets.map(asset => [asset.path, asset]))
    const original = '[Report](<./../Files/report.pdf>)'
    expect(rebaseAttachmentReferences(original, 'Notes/Plan.md', 'Projects/Plan.md', catalog)).toBe(original)
  })

  it('prepares moved descendants and Yjs source text using the new Markdown links', () => {
    const read = readMarkdownVault({ sequence: 0, index: null, assets, files: [
      { path: 'Notes/Plan.md', text: '[Notes](../Files/report.pdf)', modifiedMs: 0 },
      { path: 'Projects.md', text: 'A project.', modifiedMs: 0 },
      { path: 'Archive.md', text: 'Archive.', modifiedMs: 0 },
    ] })
    const parent = read.workspace.pages.find(page => page.title === 'Notes')!
    const destination = read.workspace.pages.find(page => page.title === 'Projects')!
    const moved = updatePage(read.workspace, parent.id, { parentId: destination.id })
    const fresh = rebaseVaultWorkspace(read.workspace, moved, read, new Map(assets.map(asset => [asset.path, asset])))
    expect(fresh.pages.find(page => page.title === 'Plan')?.markdown).toBe('[Notes](../../Files/report.pdf)')
    const { changes } = prepareVaultSave(fresh, read, 0)
    expect(changes).toContainEqual({ path: 'Projects/Notes/Plan.md', before: null, after: '[Notes](../../Files/report.pdf)' })

    const archive = read.workspace.pages.find(page => page.title === 'Archive')!
    const queued = updatePage(fresh, destination.id, { parentId: archive.id })
    const movedAgain = rebaseVaultWorkspace(fresh, queued, read, new Map(assets.map(asset => [asset.path, asset])))
    expect(prepareVaultSave(movedAgain, read, 0).desired.get('Archive/Projects/Notes/Plan.md')).toBe('[Notes](../../../Files/report.pdf)')
  })

})
