import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { prepareVaultJournal, prepareVaultSave, readMarkdownVault } from '../desktop/vault-storage'
import { advanceNoteSidecar, openNoteSidecar } from '../desktop/vault-yjs'
import { createPage, updatePage } from '../lib/workspace'

describe('desktop vault Yjs journal', () => {
  it('replays incremental edits and compacts them without changing the document identity', () => {
    const initial = advanceNoteSidecar('note', undefined, '', 'A first draft.')!
    expect(initial.write.snapshot).toBe(true)
    const original = openNoteSidecar(initial.sidecar)
    const originalClient = [...Y.decodeStateVector(Y.encodeStateVector(original)).keys()][0]
    const changed = advanceNoteSidecar('note', initial.sidecar, 'A first draft.', 'A 🤍 second draft.')!
    expect(changed.write.snapshot).toBe(false)
    let sidecar = changed.sidecar
    let text = 'A 🤍 second draft.'
    for (let i = 0; i < 33; i++) {
      const next = text + ' β'
      sidecar = advanceNoteSidecar('note', sidecar, text, next)!.sidecar
      text = next
    }
    const recovered = openNoteSidecar(sidecar)
    expect(recovered.getText('source').toString()).toBe(text)
    expect(sidecar.updates.length).toBeLessThan(32)
    expect(sidecar.snapshot).not.toBe(initial.sidecar.snapshot)
    expect(Y.decodeStateVector(Y.encodeStateVector(recovered)).has(originalClient)).toBe(true)
    original.destroy()
    recovered.destroy()
  })

  it('incorporates an external Markdown edit into the same journal on the next durable save', () => {
    const empty = readMarkdownVault({ sequence: 0, index: null, files: [] })
    const workspace = createPage(empty.workspace, { title: 'Lab', markdown: 'Notebook.' })
    const noteId = workspace.activePageId!
    const first = prepareVaultSave(workspace, empty, 0)
    const created = prepareVaultJournal(first.index, first.desired, empty)
    const sidecar = [...created.sidecars.values()][0]
    const modified = '# Lab\r\n\r\nExternal 👋 edit.\r\n'
    const observed = readMarkdownVault({ sequence: 1, index: first.index, sidecars: [sidecar],
      files: [{ path: 'Lab.md', text: modified, modifiedMs: 0 }] })
    expect(observed.changedOnDisk.has(noteId)).toBe(true)
    const favorite = updatePage(observed.workspace, noteId, { favorite: true })
    const next = prepareVaultSave(favorite, observed, 1)
    expect(next.changes).toEqual([])
    const ingested = prepareVaultJournal(next.index, next.desired, observed)
    expect(ingested.updates).toMatchObject([{ key: sidecar.key, snapshot: false }])
    const recovered = openNoteSidecar(ingested.sidecars.get(sidecar.key))
    expect(recovered.getText('source').toString()).toBe(modified)
    recovered.destroy()
  })

  it('keeps the same journal key when a note moves', () => {
    const empty = readMarkdownVault({ sequence: 0, index: null, files: [] })
    const workspace = createPage(empty.workspace, { title: 'Lab', markdown: 'Notebook.' })
    const first = prepareVaultSave(workspace, empty, 0)
    const initial = prepareVaultJournal(first.index, first.desired, empty)
    const read = readMarkdownVault({ sequence: 1, index: first.index, sidecars: [...initial.sidecars.values()],
      files: [{ path: 'Lab.md', text: 'Notebook.', modifiedMs: 0 }] })
    const renamed = updatePage(read.workspace, workspace.activePageId!, { title: 'Archive' })
    const next = prepareVaultSave(renamed, read, 1)
    const continued = prepareVaultJournal(next.index, next.desired, read)
    expect(next.index.pages[0]).toMatchObject({ path: 'Archive.md', sidecar: [...initial.sidecars.keys()][0] })
    expect(continued.updates).toEqual([])
  })
})
