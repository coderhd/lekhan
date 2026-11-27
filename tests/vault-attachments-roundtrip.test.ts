import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readVaultZip } from '../lib/vault-reader'
import { planVaultImport } from '../lib/vault-import'
import { applyVaultImport } from '../lib/workspace'
import { makeWorkspaceArchive } from '../lib/workspace-export'
import type { Workspace } from '../lib/types'
import { workspaceManifestPath } from '../lib/archive-metadata'

const initial: Workspace = { revision: 0, pages: [], activePageId: null }

async function restore(bytes: Uint8Array, local = true) {
  const contents = await readVaultZip(new File([new Uint8Array(bytes)], 'vault.zip'), local)
  return applyVaultImport(initial, await planVaultImport(contents, local))
}

describe('vault file restoration', () => {
  it('keeps linked general files as inert downloads and re-exports their relative links with the original bytes', async () => {
    const pdf = strToU8('%PDF-1.7 report')
    const html = strToU8('<script>alert("download only")</script>')
    const archive = zipSync({
      'Work/Index.md': strToU8('[[../Media/Report.pdf#page=3|Read the report]]\n\n[HTML sample][demo]\n\n[demo]: <../Media/Example.html>\n\n`[[example.exe]]`'),
      'Media/Report.pdf': pdf,
      'Media/Example.html': html,
      'Media/unlinked.bin': Uint8Array.of(7),
    })
    const restored = await restore(archive)
    const note = restored.workspace.pages.find(page => page.title === 'Index')!
    expect(restored.report).toMatchObject({ files: 2, omittedFiles: 1, degraded: 0 })
    expect(note.markdown).toMatch(/\[Read the report\]\(#lekhan-file-[a-f0-9-]+-%23page%3D3\)/)
    expect(note.markdown).toMatch(/\[demo\]: <#lekhan-file-[a-f0-9-]+>/)
    expect(note.markdown).toContain('`[[example.exe]]`')
    expect(note.files?.map(file => file.filename)).toEqual(['Report.pdf', 'Example.html'])

    const exported = await makeWorkspaceArchive(restored.workspace.pages)
    const files = unzipSync(exported)
    expect(files['Work.md']).toBeUndefined()
    expect(files['Attachments/Files/1/Report.pdf']).toEqual(pdf)
    expect(files['Attachments/Files/2/Example.html']).toEqual(html)
    expect(strFromU8(files['Work/Index.md'])).toContain('[Read the report](../Attachments/Files/1/Report.pdf#page=3)')
    expect(strFromU8(files['Work/Index.md'])).toContain('[demo]: <../Attachments/Files/2/Example.html>')
    const reopened = await restore(exported)
    expect(reopened.report).toMatchObject({ files: 2, folders: 1 })
    expect(reopened.workspace.pages.find(page => page.title === 'Work')?.folder).toBe(true)
    const restoredReport = reopened.workspace.pages.find(page => page.title === 'Index')?.files?.find(file => file.filename === 'Report.pdf')
    expect(restoredReport?.data).toEqual(pdf)
  })

  it('restores declared unlinked files in a cloud page archive, including a Markdown attachment', async () => {
    const archive = zipSync({
      'Meeting.md': strToU8('# Meeting\n\nNotes from today.'),
      'Files/Agenda.md': strToU8('# This is an attached file'),
      'Files/Notes.pdf': Uint8Array.of(1, 2, 3),
      [workspaceManifestPath]: strToU8(JSON.stringify({
        version: 1, attachments: 'Attachments',
        notes: { 'Meeting.md': { title: 'Meeting', generatedHeading: true, files: ['Files/Agenda.md', 'Files/Notes.pdf'] } },
      })),
    })
    const reopened = await restore(archive)
    expect(reopened.workspace.pages).toHaveLength(1)
    expect(reopened.workspace.pages[0].files?.map(file => file.filename)).toEqual(['Agenda.md', 'Notes.pdf'])
    expect(reopened.report).toMatchObject({ notes: 1, files: 2 })
    const cloud = await restore(archive, false)
    expect(cloud.workspace.pages.map(page => page.title)).toEqual(['Meeting'])
    expect(cloud.report).toMatchObject({ notes: 1, omittedFiles: 2 })
  })
})
