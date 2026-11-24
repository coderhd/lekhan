import { unzipSync, strFromU8 } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeCloudPageArchive } from '../lib/cloud/page-export'
import { readVaultZip } from '../lib/vault-reader'
import { planVaultImport } from '../lib/vault-import'
import { applyVaultImport } from '../lib/workspace'
import type { Page } from '../lib/types'

const page: Page = {
  id: 'page', parentId: 'previous-parent', title: 'Field note', favorite: false, createdAt: '', updatedAt: '',
  markdown: 'Unsynced sentence.\n\n![Chart](data:image/png;base64,iVBORw0KGgoBAg==)',
}

function fixture(failure?: 'denied' | 'truncated') {
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (request: string | URL, options?: RequestInit) => {
    const url = new URL(request, 'https://lekhan.example')
    requests.push(url.pathname + url.search)
    if (url.pathname === '/api/attachments') {
      return Response.json(url.searchParams.has('after')
        ? { files: [{ id: 'second', filename: 'REPORT.txt', byte_count: 3 }], after: null }
        : { files: [{ id: 'first', filename: 'Report.txt', byte_count: 2 }], after: 'first' })
    }
    if (url.pathname === '/api/sync/session') {
      expect(url.searchParams.get('transfer')).toBe('attachment')
      return Response.json({ endpoint: 'wss://relay.example', ticket: 'signed' })
    }
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer signed' })
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error' })
    if (url.pathname.endsWith('/first')) return new Response(Uint8Array.of(1, 2))
    if (failure === 'denied') return Response.json({}, { status: 404 })
    return new Response(failure === 'truncated' ? Uint8Array.of(3, 4) : Uint8Array.of(3, 4, 5))
  }))
  return requests
}

afterEach(() => vi.unstubAllGlobals())

describe('cloud page export', () => {
  it('assembles the local text and exact attachment bytes across list pages', async () => {
    const requests = fixture()
    const progress = vi.fn()
    const output = new TransformStream<Uint8Array<ArrayBuffer>>()
    const [bytes] = await Promise.all([
      new Response(output.readable).arrayBuffer(),
      writeCloudPageArchive(page, output.writable, new AbortController().signal, progress),
    ])
    const files = unzipSync(new Uint8Array(bytes))
    expect(strFromU8(files['Field note.md'])).toContain('Unsynced sentence.\n\n![Chart](Attachments/image-1.png)')
    expect(files['Attachments/image-1.png']).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]))
    expect(files['Files/Report.txt']).toEqual(Uint8Array.of(1, 2))
    expect(files['Files/REPORT (2).txt']).toEqual(Uint8Array.of(3, 4, 5))
    const plan = await planVaultImport(await readVaultZip(new File([bytes], 'cloud.zip'), true), true)
    const { workspace, report } = applyVaultImport({ revision: 0, pages: [], activePageId: null }, plan)
    expect(report).toMatchObject({ notes: 1, images: 1, files: 2 })
    expect(workspace.pages[0].files?.map(({ filename }) => filename)).toEqual(['Report.txt', 'REPORT (2).txt'])
    expect(workspace.pages[0].files?.[1].data).toEqual(Uint8Array.of(3, 4, 5))
    expect(requests).toContain('/api/attachments?pageId=page&after=first')
    expect(progress.mock.calls).toEqual([[{ completed: 0, total: 2 }], [{ completed: 1, total: 2 }], [{ completed: 2, total: 2 }]])
  })

  it.each(['denied', 'truncated'] as const)('discards the output after an attachment is %s', async failure => {
    fixture(failure)
    const close = vi.fn()
    const abort = vi.fn()
    const output = new WritableStream<Uint8Array>({ close, abort })
    await expect(writeCloudPageArchive(page, output, new AbortController().signal, vi.fn())).rejects.toThrow()
    expect(abort).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
    expect(close).not.toHaveBeenCalled()
    expect(output.locked).toBe(false)
  })
  it('cancels the remaining transfers and aborts the output', async () => {
    const requests = fixture()
    const close = vi.fn()
    const abort = vi.fn()
    const cancel = new AbortController()
    const output = new WritableStream<Uint8Array>({ close, abort })
    const exportZip = writeCloudPageArchive(page, output, cancel.signal, ({ completed }) => {
      if (completed === 1) cancel.abort()
    })
    await expect(exportZip).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).not.toContain('/attachments/page/second')
    expect(abort).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    expect(output.locked).toBe(false)
  })

})
