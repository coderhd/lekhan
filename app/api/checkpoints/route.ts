import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import * as Y from 'yjs'
import { createServerAdmin } from '@/lib/auth/admin'
import { accountContext } from '@/lib/auth/server'
import { workspaceEntitlementOrFree } from '@/lib/billing/entitlements'
import { checkpointMaxBytes, checkpointName, type Checkpoint } from '@/lib/cloud/checkpoints'
import { pageAccess, uuidPattern } from '@/lib/cloud/graph'
import { getExpirationCutoffDate } from '@/lib/tier-limits'
import { snapshotCipher } from '@/server/sync/snapshot'

const headers = { 'Cache-Control': 'private, no-store' }
const fields = 'id,version_name,created_at'

function failure(status: number, error: string) {
  return NextResponse.json({ error }, { headers, status })
}

async function checkpointAccess(request: NextRequest) {
  const pageId = request.nextUrl.searchParams.get('pageId')
  if (!pageId || !uuidPattern.test(pageId)) return failure(400, 'invalid_page')
  const account = await accountContext()
  if (!account) return failure(401, 'sign_in_required')
  const access = await pageAccess(account.client, pageId, account.subject)
  if (!access?.privateAccess) return failure(404, 'page_not_found')
  const admin = createServerAdmin()
  if (!admin) return failure(503, 'checkpoints_unavailable')
  const plan = await workspaceEntitlementOrFree(access.page.workspace_id, admin)
  const cutoff = getExpirationCutoffDate(plan?.tier).toISOString()
  return { account, admin, access, cutoff, pageId, writable: access.role !== 'viewer' && !plan?.relayReadOnly }
}

function cipher() {
  const primary = process.env.LEKHAN_ENCRYPTION_KEY?.trim()
  if (!primary) throw new Error('Checkpoint encryption is unavailable.')
  return snapshotCipher(primary, (process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS ?? '').split(',').map(value => value.trim()).filter(Boolean))
}

function objectPath(pageId: string, versionId: string) {
  return pageId + '/versions/' + versionId + '.bin'
}

export async function GET(request: NextRequest) {
  try {
    const context = await checkpointAccess(request)
    if (context instanceof Response) return context
    const { account, admin, cutoff, pageId, writable } = context
    const version = request.nextUrl.searchParams.get('version')
    const query = account.client.from('document_versions').select(fields).eq('page_id', pageId).gte('created_at', cutoff)
    if (!version) {
      const { data, error } = await query.order('created_at', { ascending: false }).limit(50).returns<Checkpoint[]>()
      if (error) throw error
      return NextResponse.json({ checkpoints: data, writable }, { headers })
    }
    if (!uuidPattern.test(version)) return failure(400, 'invalid_checkpoint')
    const { data: record, error: recordError } = await query.eq('id', version).maybeSingle<Checkpoint>()
    if (recordError) throw recordError
    if (!record) return failure(404, 'checkpoint_not_found')
    const { data, error } = await admin.storage.from('documents').download(objectPath(pageId, version))
    if (error) throw error
    if (data.size > checkpointMaxBytes + 36) return failure(413, 'checkpoint_too_large')
    const snapshot = cipher().open(new Uint8Array(await data.arrayBuffer()), 'checkpoint:' + pageId + ':' + version)
    return new Response(new Uint8Array(snapshot), { headers: { ...headers, 'Content-Type': 'application/octet-stream' } })
  } catch {
    return failure(503, 'checkpoints_unavailable')
  }
}

async function boundedSnapshot(request: NextRequest) {
  const source = request.body?.getReader()
  if (!source) return null
  let size = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await source.read()
    if (done) break
    size += value.byteLength
    if (size > checkpointMaxBytes) {
      await source.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, size)
}

export async function POST(request: NextRequest) {
  try {
    const context = await checkpointAccess(request)
    if (context instanceof Response) return context
    if (!context.writable) return failure(403, 'read_only')
    const { account, admin, pageId } = context
    const name = checkpointName(request.nextUrl.searchParams.get('name'))
    if (!name || request.headers.get('content-type') !== 'application/octet-stream') return failure(400, 'invalid_checkpoint')
    const snapshot = await boundedSnapshot(request)
    if (!snapshot) return failure(413, 'checkpoint_too_large')
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, snapshot)
    } catch {
      return failure(400, 'invalid_checkpoint')
    } finally {
      doc.destroy()
    }

    const id = randomUUID()
    const path = objectPath(pageId, id)
    const encrypted = cipher().seal(snapshot, 'checkpoint:' + pageId + ':' + id)
    const bucket = admin.storage.from('documents')
    const { error: uploadError } = await bucket.upload(path, encrypted, { contentType: 'application/octet-stream', upsert: false })
    if (uploadError) throw uploadError
    const { data, error } = await account.client.from('document_versions').insert({
      id, page_id: pageId, version_name: name, created_by: account.subject, storage_path: path,
    }).select(fields).single<Checkpoint>()
    if (error) {
      const { data: existing, error: readError } = await admin.from('document_versions').select(fields).eq('id', id).maybeSingle<Checkpoint>()
      if (existing) return NextResponse.json({ checkpoint: existing }, { status: 201, headers })
      if (!readError) await bucket.remove([path])
      throw error
    }
    return NextResponse.json({ checkpoint: data }, { status: 201, headers })
  } catch {
    return failure(503, 'checkpoints_unavailable')
  }
}
