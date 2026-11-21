import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { cloudImportPlan } from '../lib/cloud/import-plan'
import { importPageId, validateCloudImport, writeCloudBatch } from '../lib/cloud/import-server'
import { snapshotCipher } from '../server/sync/snapshot'

const attempt = '40000000-0000-4000-8000-000000000001'
const workspace = '40000000-0000-4000-8000-000000000002'
const owner = '40000000-0000-4000-8000-000000000003'

describe('cloud vault import', () => {
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
    let finalized = false
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
      if (url.pathname.includes('/storage/')) {
        const id = url.pathname.split('/').at(-2)!
        requests.push((init?.method ?? 'GET') + ' ' + id)
        if (url.pathname.includes('/object/info/')) return Response.json(assets.has(id) ? { id } : { message: 'Not found' }, { status: assets.has(id) ? 200 : 404 })
        if (fail && id === importPageId(workspace, attempt, 2)) return Response.json({ message: 'Unavailable' }, { status: 503 })
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
