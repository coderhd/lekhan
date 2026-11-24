import { NextResponse } from 'next/server'
import { createServerAdmin } from '@/lib/auth/admin'
import { accountContext } from '@/lib/auth/server'
import { workspaceEntitlementOrFree } from '@/lib/billing/entitlements'
import { ensureCloudWorkspace, uuidPattern } from '@/lib/cloud/graph'
import { MAX_IMPORT_BATCH_BYTES } from '@/lib/cloud/import-plan'
import { allowCloudImportImages, cloudImportImageContext, validateCloudImport, writeCloudBatch } from '@/lib/cloud/import-server'
import { readBoundedBody } from '@/lib/server/read-body'
import { recordAnalyticsReceipt } from '@/lib/server/analytics'
import { configuredSnapshotCipher } from '@/server/sync/snapshot'

const headers = { 'Cache-Control': 'private, no-store' }

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers })
}

export async function GET(request: Request) {
  const account = await accountContext()
  if (!account) return failure('sign_in_required', 401)
  const params = new URL(request.url).searchParams
  const attempt = params.get('attempt')
  if (!attempt || !uuidPattern.test(attempt)) return failure('invalid_import', 400)
  const admin = createServerAdmin()
  if (!admin) return failure('import_unavailable', 503)
  try {
    const workspace = await account.client.from('workspaces').select('id')
      .eq('owner_id', account.subject).maybeSingle<{ id: string }>()
    if (workspace.error) throw workspace.error
    if (params.get('sync') === 'automatic') {
      const plan = workspace.data && await workspaceEntitlementOrFree(workspace.data.id, admin)
      if (!plan || plan.tier === 'free' || plan.relayReadOnly) return failure('import_paid_sync_ended', 409)
    }
    return NextResponse.json(
      { ...await cloudImportImageContext(admin, workspace.data?.id ?? null, account.subject, attempt), account: account.subject }, { headers },
    )
  } catch {
    return failure('import_unavailable', 503)
  }
}

export async function POST(request: Request) {
  const account = await accountContext()
  if (!account) return failure('sign_in_required', 401)
  const expectedAccount = request.headers.get('x-lekhan-account')
  if (expectedAccount !== null && expectedAccount !== account.subject) return failure('account_changed', 403)
  if (request.headers.get('content-type') !== 'application/json') return failure('invalid_import', 415)
  const admin = createServerAdmin()
  const cipher = configuredSnapshotCipher()
  if (!admin || !cipher) return failure('import_unavailable', 503)
  try {
    const raw = await readBoundedBody(request, MAX_IMPORT_BATCH_BYTES)
    if (!raw) return failure('import_too_large', 413)
    let input: unknown
    try { input = JSON.parse(raw.toString('utf8')) } catch { return failure('invalid_import', 400) }
    const batch = validateCloudImport(input)
    const automatic = new URL(request.url).searchParams.get('sync') === 'automatic'
    if (!batch || (automatic && !batch.localMirror)) return failure('invalid_import', 400)
    const { id: workspaceId, created } = await ensureCloudWorkspace(account.client, account.subject)
    if (created) await recordAnalyticsReceipt('workspace')
    const context = await cloudImportImageContext(admin, workspaceId, account.subject, batch.importId, batch.index)
    const reserved = context.batches[0]
    const policy = reserved ? reserved.policy : context.current
    if (batch.imagePolicy !== undefined && batch.imagePolicy !== policy) return failure('import_image_policy_changed', 409)
    if (policy && !allowCloudImportImages(batch, policy)) return failure(
      policy === 'free' ? 'import_free_image_limit' : 'import_paid_image_limit', 413,
    )
    try {
      const receipt = await writeCloudBatch(admin, cipher, workspaceId, account.subject, { ...batch, imagePolicy: policy }, automatic)
      return NextResponse.json(receipt, { headers })
    } catch (error) {
      const message = (error as { message?: unknown }).message
      if (message === 'import_workspace_media_limit') return failure(message, 413)
      if (message === 'import_workspace_not_found') return failure('workspace_not_found', 404)
      if (message === 'import_payload_changed' || message === 'import_parent_missing' ||
        message === 'import_batch_out_of_order' || message === 'import_image_policy_changed' ||
        message === 'import_paid_sync_ended') return failure(message, 409)
      if (message === 'invalid_import') return failure(message, 400)
      throw error
    }
  } catch {
    return failure('import_unavailable', 503)
  }
}
