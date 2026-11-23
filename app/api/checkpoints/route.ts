import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import * as Y from 'yjs'
import { createServerAdmin } from '@/lib/auth/admin'
import { accountContext } from '@/lib/auth/server'
import { workspaceEntitlementOrFree } from '@/lib/billing/entitlements'
import { checkpointMaxBytes, checkpointName, type Checkpoint } from '@/lib/cloud/checkpoints'
import { cloudImageAllowed } from '@/lib/cloud/image-policy'
import { pageAccess, uuidPattern } from '@/lib/cloud/graph'
import { getExpirationCutoffDate, getPlanLimits } from '@/lib/tier-limits'
import { readBoundedBody } from '@/lib/server/read-body'
import { configuredSnapshotCipher } from '@/server/sync/snapshot'
import { addedDocumentImages, documentImages, imageRoots } from '@/server/sync/document-images'
import { cloudSnapshots } from '@/server/sync/supabase'

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
  const retentionDays = getPlanLimits(plan?.tier, plan?.seats).historyRetentionDays
  const imagePolicy = plan && plan.tier !== 'free' ? 'paid' as const : 'free' as const
  return { account, admin, access, cutoff, pageId, imagePolicy, retentionDays, writable: access.role !== 'viewer' && !plan?.relayReadOnly }
}

function cipher() {
  const configured = configuredSnapshotCipher()
  if (!configured) throw new Error('Checkpoint encryption is unavailable.')
  return configured
}

function objectPath(pageId: string, versionId: string) {
  return pageId + '/versions/' + versionId + '.bin'
}

export async function GET(request: NextRequest) {
  try {
    const context = await checkpointAccess(request)
    if (context instanceof Response) return context
    const { access, account, admin, cutoff, pageId, retentionDays, writable } = context
    const version = request.nextUrl.searchParams.get('version')
    const query = account.client.from('document_versions').select(fields).eq('page_id', pageId).gte('created_at', cutoff)
    if (!version) {
      const [history, older] = await Promise.all([
        query.order('created_at', { ascending: false }).limit(50).returns<Checkpoint[]>(),
        account.client.from('document_versions').select('id').eq('page_id', pageId).lt('created_at', cutoff).limit(1),
      ])
      if (history.error) throw history.error
      return NextResponse.json({
        checkpoints: history.data, writable, retentionDays,
        olderHistoryLimited: !!older.data?.length, canManageHistory: access.role === 'owner',
      }, { headers })
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

export async function POST(request: NextRequest) {
  try {
    const context = await checkpointAccess(request)
    if (context instanceof Response) return context
    if (!context.writable) return failure(403, 'read_only')
    const { account, admin, pageId, imagePolicy } = context
    const name = checkpointName(request.nextUrl.searchParams.get('name'))
    if (!name || request.headers.get('content-type') !== 'application/octet-stream') return failure(400, 'invalid_checkpoint')
    const snapshot = await readBoundedBody(request, checkpointMaxBytes)
    if (!snapshot) return failure(413, 'checkpoint_too_large')
    const encryption = cipher()
    const doc = new Y.Doc()
    try {
      try {
        Y.applyUpdate(doc, snapshot)
        if (doc.store.pendingStructs || doc.store.pendingDs) return failure(400, 'invalid_checkpoint')
      } catch {
        return failure(400, 'invalid_checkpoint')
      }
      const submitted = documentImages(imageRoots(doc))
      const empty = { source: new Map<string, number>(), rich: new Map<string, number>() }
      const disallowed = (source: string) => !cloudImageAllowed(source, imagePolicy)
      if ([...addedDocumentImages(empty, submitted)].some(disallowed)) {
        const current = new Y.Doc()
        try {
          const saved = await cloudSnapshots(admin, encryption).load(pageId)
          if (saved) Y.applyUpdate(current, saved)
          if ([...addedDocumentImages(documentImages(imageRoots(current)), submitted)].some(disallowed)) {
            return failure(413, 'checkpoint_image_limit')
          }
        } finally {
          current.destroy()
        }
      }
    } finally {
      doc.destroy()
    }

    const id = randomUUID()
    const path = objectPath(pageId, id)
    const encrypted = encryption.seal(snapshot, 'checkpoint:' + pageId + ':' + id)
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
