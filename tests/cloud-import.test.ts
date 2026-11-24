import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { bindCloudImportFiles, cloudImportPlan } from '../lib/cloud/import-plan'
import { allowCloudImportImages, importPageId, validateCloudImport, writeCloudBatch } from '../lib/cloud/import-server'
import { cloudImageAllowed, FREE_IMAGE_BYTES, inlineCloudImages, PAID_IMAGE_BYTES } from '../lib/cloud/image-policy'
import { snapshotCipher } from '../server/sync/snapshot'
import { localMirrorPlacement, nextAutomaticMirror, prepareLocalMirror, uploadLocalMirror } from '../lib/cloud/local-mirror'
import { starterWorkspace } from '../lib/starter-workspace'

const attempt = '40000000-0000-4000-8000-000000000001'
const workspace = '40000000-0000-4000-8000-000000000002'
const owner = '40000000-0000-4000-8000-000000000003'

describe('cloud vault import', () => {
  it('queues real notebook content with its ancestors and defers the note being edited', () => {
    const { pages } = starterWorkspace()
    expect(nextAutomaticMirror(pages)).toBeUndefined()
    const edited = pages.map(page => page.id === 'reading-list' ? { ...page, markdown: 'New reading notes' } : page)
    expect(nextAutomaticMirror(edited)?.id).toBe('projects')
    const withSyncedParent = edited.map(page => page.id === 'projects'
      ? { ...page, cloudMirror: { state: 'linked' as const, pageId: owner } } : page)
    expect(nextAutomaticMirror(withSyncedParent, 'reading-list')).toBeUndefined()
    expect(nextAutomaticMirror(withSyncedParent)?.id).toBe('reading-list')
  })

  it('keeps the selected note and uses the same batch on retry after a lost response', async () => {
    const recorded: string[] = []
    let lost = true
    const pageId = '40000000-0000-4000-8000-000000000004'
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/import?')) return Response.json({ current: 'free', batches: [] })
      recorded.push(String(init?.body))
      if (lost) throw new TypeError('network interruption')
      return Response.json({ pages: [{ id: pageId, title: 'A selected page' }], importedCount: 1, replayed: true })
    })
    try {
      const signal = new AbortController().signal
      const note = { id: 'starter-page', parentId: null, title: 'A selected page', markdown: 'Private [[local link]]',
        frontmatter: '---\ntags: [draft]\n---\n', properties: { tags: ['draft'] }, favorite: false, createdAt: '', updatedAt: '' }
      const pending = await prepareLocalMirror(note, signal, { notebook: workspace, key: note.id, parent: null, known: [] })
      const { batch } = pending
      expect(batch.pages).toEqual([{ ordinal: 0, parent: null, title: note.title, path: note.title,
        markdown: note.markdown, frontmatter: note.frontmatter, properties: note.properties }])
      expect(validateCloudImport(batch)).toEqual(batch)
      expect(validateCloudImport({ ...batch, localMirror: { ...batch.localMirror, parent: note.id } })).toBeNull()
      await expect(uploadLocalMirror(pending, [], signal)).rejects.toThrow('Retry sync')
      // Simulate IndexedDB returning the previously selected payload.
      lost = false
      await expect(uploadLocalMirror({ state: 'pending', batch: JSON.parse(JSON.stringify(batch)) }, [], signal)).resolves.toBe(pageId)
      expect(recorded).toEqual([JSON.stringify(batch), JSON.stringify(batch)])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('resumes a notebook file from its durable draft and keeps the page pending until the relay confirms', async () => {
    const file = { id: attempt, filename: 'Report.pdf', data: Uint8Array.of(1, 2, 3) }
    const note = { id: 'reading-list', parentId: null, title: 'My research',
      markdown: `[Read](#lekhan-file-${file.id}-%23page%3D2)`,
      files: [file], favorite: false, createdAt: '', updatedAt: '' }
    const posts: string[] = []
    const uploads: string[] = []
    let lost = true
    const pageId = '40000000-0000-4000-8000-000000000004'
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      const target = String(url)
      const headers = new Headers(init?.headers)
      if (target.startsWith('/api/import?') && !init?.method) return Response.json({ current: 'paid', batches: [], account: owner })
      if (target === '/api/import?sync=automatic') {
        expect(headers.get('X-Lekhan-Account')).toBe(owner)
        posts.push(String(init?.body))
        return Response.json({ pages: [{ id: pageId, title: note.title }] })
      }
      if (target.startsWith('/api/sync/session?')) {
        expect(target).toContain('account=' + owner)
        return Response.json({ endpoint: 'wss://cloud.example.test', ticket: 'fixture' })
      }
      expect(target).toMatch(new RegExp(`/attachments/${pageId}/`))
      const id = target.split('/').at(-1)!
      uploads.push(id)
      expect(headers.get('X-Lekhan-SHA256')).toMatch(/^[a-f0-9]{64}$/)
      expect(init?.body).toEqual(file.data)
      if (lost) return Response.json({ error: 'attachments_unavailable' }, { status: 503 })
      return Response.json({ id, filename: file.filename, byte_count: file.data.byteLength })
    })
    try {
      const signal = new AbortController().signal
      expect(nextAutomaticMirror([note])).toBe(note)
      expect(nextAutomaticMirror([{ ...note, files: [{ ...file, data: new Uint8Array(0) }] }])).toBeUndefined()
      const pending = await prepareLocalMirror(note, signal, { notebook: workspace, key: note.id, parent: null, known: [] }, true)
      const transfer = pending.files![0]
      expect(transfer).not.toHaveProperty('data')
      expect(transfer.sourceId).toBe(file.id)
      expect(pending.batch.pages[0].markdown).toBe(`[Read](#lekhan-file-${transfer.id}-%23page%3D2)`)
      await expect(uploadLocalMirror(pending, [], signal, true)).rejects.toThrow('could not be read')
      expect(posts).toHaveLength(0)
      await expect(uploadLocalMirror(pending, note.files, signal, true)).rejects.toThrow('The file transfer could not finish')
      const reopened = { ...note, cloudMirror: JSON.parse(JSON.stringify(pending)) }
      expect(nextAutomaticMirror([reopened], note.id)).toBe(reopened)
      lost = false
      await expect(uploadLocalMirror(reopened.cloudMirror, reopened.files, signal, true)).resolves.toBe(pageId)
      expect(posts).toEqual([JSON.stringify(pending.batch), JSON.stringify(pending.batch)])
      expect(uploads).toEqual([transfer.id, transfer.id])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses stable file IDs, changes them across accounts, and binds note links to those IDs', async () => {
    const plan = {
      fingerprint: 'e'.repeat(64), invalidProperties: 0, directories: [], images: new Map(),
      notes: [{ sourcePath: 'Page.md', title: 'Page', markdown: '[Report](report.pdf#page=2)' }],
      attachments: new Map([['report.pdf', Uint8Array.of(1, 2, 3)]]),
    }
    const first = await bindCloudImportFiles(cloudImportPlan(plan), owner, 'free')
    const second = await bindCloudImportFiles(cloudImportPlan(plan), owner, 'free')
    const other = await bindCloudImportFiles(cloudImportPlan(plan), workspace, 'free')
    expect(first.batches).toEqual(second.batches)
    expect(first.files[0]).toMatchObject({ id: second.files[0].id, digest: second.files[0].digest,
      filename: second.files[0].filename, ordinal: second.files[0].ordinal, data: second.files[0].data })
    expect(first.files[0].id).not.toBe(other.files[0].id)
    expect(first.files[0].digest).toMatch(/^[a-f0-9]{64}$/)
    expect(first.batches[0].pages[0].markdown).toContain('#lekhan-file-' + first.files[0].id + '-%23page%3D2')
    await expect(bindCloudImportFiles(cloudImportPlan(plan), undefined, 'free')).rejects.toThrow('verify the account')

    plan.attachments.set('report.pdf', new Uint8Array(2_000_001))
    await expect(bindCloudImportFiles(cloudImportPlan(plan), owner, 'free')).rejects.toThrow('2 MB file limit')
    await expect(bindCloudImportFiles(cloudImportPlan(plan), owner, 'paid')).resolves.toMatchObject({ files: [{ filename: 'report.pdf' }] })
  })

  it('sends identities of already-linked neighbors without adding their content to a local mirror', () => {
    const base = { title: 'Page', markdown: 'Private text', favorite: false, createdAt: '', updatedAt: '' }
    const parent = { ...base, id: 'parent', parentId: null, cloudMirror: { state: 'linked' as const, pageId: owner } }
    const child = { ...base, id: 'child', parentId: parent.id }
    const sibling = { ...base, id: 'sibling', parentId: parent.id, cloudMirror: { state: 'linked' as const, pageId: attempt } }
    expect(localMirrorPlacement({ revision: 0, activePageId: child.id, pages: [parent, child, sibling] }, child, workspace)).toEqual({
      notebook: workspace, key: 'child', parent: 'parent', known: [{ key: 'parent', parent: null, page: owner }],
    })
  })

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

  it('checks decoded imported images against workspace usage before writing snapshots', async () => {
    const requests: string[] = []
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      requests.push(path.split('/').at(-1)!)
      if (path.endsWith('/rebuild_import_batch')) return Response.json(null)
      expect(path).toContain('/rebuild_reserve_page_images')
      expect(JSON.parse(String(init?.body))).toEqual({ target_workspace: workspace, importing: true,
        requested: [{ page: importPageId(workspace, attempt, 0), bytes: 6 }] })
      return Response.json(false)
    }
    const client = createClient('https://fixture.example', 'sb_secret_fixture', {
      global: { fetch: fetcher as typeof fetch }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const image = '![Scan](data:image/png;base64,AAAABBBB)'
    const cipher = snapshotCipher('a local fixture encryption key at least 32 characters long')
    const batch = { importId: attempt, index: 0, pages: [{ ordinal: 0, parent: null, title: 'Note', path: 'Note', markdown: image }] }
    await expect(writeCloudBatch(client, cipher, workspace, owner, batch)).rejects.toThrow('import_workspace_media_limit')
    expect(requests).toEqual(['rebuild_import_batch', 'rebuild_reserve_page_images'])
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
