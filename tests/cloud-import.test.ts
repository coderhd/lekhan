import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { cloudImportPlan } from '../lib/cloud/import-plan'
import { allowCloudImportImages, importPageId, validateCloudImport, writeCloudBatch } from '../lib/cloud/import-server'
import { cloudImageAllowed, FREE_IMAGE_BYTES, inlineCloudImages, PAID_IMAGE_BYTES } from '../lib/cloud/image-policy'
import { snapshotCipher } from '../server/sync/snapshot'

const attempt = '40000000-0000-4000-8000-000000000001'
const workspace = '40000000-0000-4000-8000-000000000002'
const owner = '40000000-0000-4000-8000-000000000003'

describe('cloud vault import', () => {
  it('verifies WebP dimensions and charges decoded image bytes against the selected cloud cap', () => {
    const tiny = Buffer.from('UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoBAAEAAUAmJZACdLoAA5gA/vQYt8VvqBnIP+Aunui8QAAA', 'base64')
    const source = 'data:image/webp;base64,' + tiny.toString('base64')
    expect(cloudImageAllowed(source, 'free')).toBe(true)
    const wider = Buffer.from(tiny)
    wider.writeUInt16LE(1601, 26)
    expect(cloudImageAllowed('data:image/webp;base64,' + wider.toString('base64'), 'free')).toBe(false)
    expect(cloudImageAllowed('data:image/webp;base64,' + Buffer.alloc(FREE_IMAGE_BYTES + 1).toString('base64'), 'free')).toBe(false)
    const paid = 'data:image/png;base64,' + Buffer.alloc(PAID_IMAGE_BYTES + 1).toString('base64')
    expect(cloudImageAllowed(paid, 'paid')).toBe(false)
    expect(cloudImageAllowed(source.replace('/webp', '/png'), 'paid')).toBe(true)
  })

  it('applies the policy to inline embeds and leaves code examples intact', () => {
    const image = 'data:image/png;base64,AAAA'
    const snippet = '![](' + image + ')'
    const code = ['`' + snippet + '`', '', '```md', snippet, '```'].join('\n')
    const pages = [{ ordinal: 0, parent: null, title: 'Examples', path: 'Examples', markdown: code }]
    expect(allowCloudImportImages({ importId: attempt, index: 0, pages }, 'free')).toBe(true)
    const markdown = code + '\n\n' + snippet
    const batch = { importId: attempt, index: 0, pages: [{ ...pages[0], markdown }] }
    expect([...inlineCloudImages(markdown)].map(record => record.source)).toEqual([image])
    expect(allowCloudImportImages(batch, 'free')).toBe(false)
    expect(allowCloudImportImages(batch, 'paid')).toBe(true)
  })

  it('makes batches stable across independent reads and preserves hierarchy and frontmatter', () => {
    const plan = {
      fingerprint: 'a'.repeat(64),
      notes: Array.from({ length: 55 }, (_, index) => ({
        sourcePath: `Lab/Entry ${index}.md`, title: `Entry ${index}`, markdown: 'Notes #lab',
        frontmatter: '---\ntags: [lab]\n---\n', properties: { tags: ['lab'] },
      })),
      directories: ['Lab'], images: new Map(), invalidProperties: 0,
    }
    const first = cloudImportPlan(plan)
    expect(cloudImportPlan(plan)).toEqual(first)
    expect(first.batches.map(batch => batch.pages.length)).toEqual([50, 6])
    expect(first.firstNote).toBe(1)
    expect(first.batches[1].pages[0]).toMatchObject({ ordinal: 50, parent: 0, path: 'Lab/Entry 49', frontmatter: '---\ntags: [lab]\n---\n' })
    expect(validateCloudImport(first.batches[1])).toEqual(first.batches[1])
    expect(validateCloudImport({ ...first.batches[1], pages: [first.batches[1].pages[0], first.batches[1].pages[2]] })).toBeNull()
  })

  it('resumes after a storage interruption, preserves an existing snapshot and skips completed batches', async () => {
    const cipher = snapshotCipher('a local fixture encryption key at least 32 characters long')
    const assets = new Map<string, Uint8Array>()
    const pages = [
      { ordinal: 0, parent: null, title: 'Lab', path: 'Lab', markdown: '' },
      { ordinal: 1, parent: 0, title: 'Draft', path: 'Lab/Draft', markdown: 'Private draft [[Lab]]' },
      { ordinal: 2, parent: 0, title: 'Plan', path: 'Lab/Plan', markdown: 'Private plan #lab' },
    ]
    let fail = true
    let capacityFull = true
    let finalized = false
    const leases = new Map<string, string>()
    const requests: string[] = []
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.pathname.endsWith('/rebuild_import_batch')) {
        const payload = JSON.parse(String(init?.body))
        if (payload.rows_to_import) finalized = true
        return Response.json(finalized ? {
          pages: pages.map(page => ({ id: importPageId(workspace, attempt, page.ordinal), title: page.title })),
          importedCount: 3, replayed: !payload.rows_to_import,
        } : null)
      }
      if (url.pathname.endsWith('/rebuild_reserve_document_upload')) {
        const { target_path, proposed_lease } = JSON.parse(String(init?.body))
        const id = target_path.split('/')[0]
        if (assets.has(id)) return Response.json('exists')
        if (capacityFull) return Response.json('full')
        if (leases.has(id)) return Response.json('busy')
        leases.set(id, proposed_lease)
        return Response.json('reserved')
      }
      if (url.pathname.endsWith('/rebuild_release_document_upload')) {
        const { completed_lease } = JSON.parse(String(init?.body))
        for (const [id, lease] of leases) if (lease === completed_lease) leases.delete(id)
        return new Response(null, { status: 204 })
      }
      if (url.pathname.includes('/storage/')) {
        const id = url.pathname.split('/').at(-2)!
        requests.push((init?.method ?? 'GET') + ' ' + id)
        if (url.pathname.includes('/object/info/')) return Response.json(assets.has(id) ? { id } : { message: 'Not found' }, { status: assets.has(id) ? 200 : 404 })
        expect(leases.has(id)).toBe(true)
        if (fail && id === importPageId(workspace, attempt, 2)) return Response.json({ message: 'Retry later', statusCode: '429' }, { status: 429 })
        if (assets.has(id)) return Response.json({ message: 'Asset already exists' }, { status: 400 })
        assets.set(id, new Uint8Array(init?.body as Uint8Array))
        return Response.json({ Key: 'documents/' + id + '/main_state.bin' })
      }
      throw new Error('Unexpected request ' + url.pathname)
    }
    const client = createClient('http://127.0.0.1:3323', 'sb_secret_fixture', {
      global: { fetch: fetcher as typeof fetch }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const batch = { importId: attempt, index: 0, pages }
    await expect(writeCloudBatch(client, cipher, workspace, owner, batch)).rejects.toMatchObject({ reason: 'full' })
    expect(requests).toHaveLength(0)
    expect(finalized).toBe(false)
    capacityFull = false
    await expect(writeCloudBatch(client, cipher, workspace, owner, batch)).rejects.toThrow()
    expect(finalized).toBe(false)
    const id = importPageId(workspace, attempt, 1)
    const original = assets.get(id)!
    expect(Buffer.from(original).includes('Private draft')).toBe(false)
    fail = false
    await expect(writeCloudBatch(client, cipher, workspace, owner, batch)).resolves.toMatchObject({ importedCount: 3, replayed: false })
    expect(assets.get(id)).toBe(original)
    const document = new Y.Doc()
    Y.applyUpdate(document, cipher.open(original, 'snapshot:' + id))
    expect(document.getText('source').toString()).toBe('Private draft [[Lab]]')
    document.destroy()
    const count = requests.length
    await expect(writeCloudBatch(client, cipher, workspace, owner, batch)).resolves.toMatchObject({ importedCount: 3, replayed: true })
    expect(requests).toHaveLength(count)
  })
})
