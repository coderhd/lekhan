import { describe, expect, it } from 'vitest'
import { attachmentMarkdown, referencedAttachments } from '../desktop/vault-attachments'

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
})
