import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { createServerAdmin } from '@/lib/auth/admin'
import { accountContext } from '@/lib/auth/server'
import { workspaceEntitlementOrFree } from '@/lib/billing/entitlements'
import { checkpointMaxBytes, checkpointName, type Checkpoint } from '@/lib/cloud/checkpoints'
import { pageAccess, uuidPattern } from '@/lib/cloud/graph'
import { getExpirationCutoffDate, getPlanLimits } from '@/lib/tier-limits'
import { readBoundedBody } from '@/lib/server/read-body'
import { configuredSnapshotCipher } from '@/server/sync/snapshot'
import { syncUrl } from '@/lib/sync/config'
import { readPageSyncPreference } from '@/lib/sync/preferences'
import { CheckpointFailure, checkpointFields, readCheckpoint, storeCheckpoint } from '@/server/sync/checkpoint-store'
import { sealCheckpointTransfer, type CheckpointOperation } from '@/server/sync/checkpoint-ticket'

const headers = { 'Cache-Control': 'private, no-store' }

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
  const paused = imagePolicy === 'free' && access.role === 'owner' && await readPageSyncPreference(admin, access.page.id) === 'paused'
  return { account, admin, access, cutoff, pageId, imagePolicy, retentionDays, writable: access.role !== 'viewer' && !plan?.relayReadOnly && !paused }
}

function cipher() {
  const configured = configuredSnapshotCipher()
  if (!configured) throw new Error('Checkpoint encryption is unavailable.')
  return configured
}

async function transferResponse(account: NonNullable<Awaited<ReturnType<typeof accountContext>>>, operation: CheckpointOperation) {
  const address = syncUrl()
  if (!address) return failure(503, 'checkpoint_transport_unavailable')
  const { data, error } = await account.client.auth.getSession()
  const accessToken = data.session?.access_token
  if (error || !accessToken) return failure(401, 'sign_in_required')
  const claims = await account.client.auth.getClaims(accessToken)
  if (claims.error || claims.data?.claims.sub !== account.subject) return failure(401, 'sign_in_required')
  const url = new URL(address)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/checkpoint-transfer'
  const token = sealCheckpointTransfer(cipher(), {
    ...operation, subject: account.subject, accessToken,
  })
  return NextResponse.json({ endpoint: url.toString(), token }, { headers })
}

function checkpointError(error: unknown) {
  return error instanceof CheckpointFailure ? failure(error.status, error.code) : failure(503, 'checkpoints_unavailable')
}

export async function GET(request: NextRequest) {
  try {
    const context = await checkpointAccess(request)
    if (context instanceof Response) return context
    const { access, account, admin, cutoff, pageId, retentionDays, writable } = context
    const version = request.nextUrl.searchParams.get('version')
    const query = account.client.from('document_versions').select(checkpointFields).eq('page_id', pageId).gte('created_at', cutoff)
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
    if (request.nextUrl.searchParams.get('transport') === 'relay') {
      return await transferResponse(account, { method: 'GET', page: pageId, version })
    }
    const snapshot = await readCheckpoint(admin, cipher(), pageId, version, checkpointMaxBytes)
    return new Response(new Uint8Array(snapshot), { headers: { ...headers, 'Content-Type': 'application/octet-stream' } })
  } catch (error) {
    return checkpointError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await checkpointAccess(request)
    if (context instanceof Response) return context
    if (!context.writable) return failure(403, 'read_only')
    const { account, admin, pageId, imagePolicy } = context
    const name = checkpointName(request.nextUrl.searchParams.get('name'))
    if (!name) return failure(400, 'invalid_checkpoint')
    const id = randomUUID()
    if (request.nextUrl.searchParams.get('transport') === 'relay') {
      return await transferResponse(account, { method: 'POST', page: pageId, version: id, name })
    }
    if (request.headers.get('content-type') !== 'application/octet-stream') return failure(400, 'invalid_checkpoint')
    const snapshot = await readBoundedBody(request, checkpointMaxBytes)
    if (!snapshot) return failure(413, 'checkpoint_too_large')
    const checkpoint = await storeCheckpoint({
      admin, actor: account.client, subject: account.subject, encryption: cipher(),
      page: pageId, id, name, policy: imagePolicy, snapshot,
    })
    return NextResponse.json({ checkpoint }, { status: 201, headers })
  } catch (error) {
    return checkpointError(error)
  }
}
