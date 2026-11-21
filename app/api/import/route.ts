import { NextResponse } from 'next/server'
import { createServerAdmin } from '@/lib/auth/admin'
import { accountContext } from '@/lib/auth/server'
import { ensureCloudWorkspace } from '@/lib/cloud/graph'
import { MAX_IMPORT_BATCH_BYTES } from '@/lib/cloud/import-plan'
import { validateCloudImport, writeCloudBatch } from '@/lib/cloud/import-server'
import { readBoundedBody } from '@/lib/server/read-body'
import { configuredSnapshotCipher } from '@/server/sync/snapshot'

const headers = { 'Cache-Control': 'private, no-store' }

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers })
}

export async function POST(request: Request) {
  const account = await accountContext()
  if (!account) return failure('sign_in_required', 401)
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
    if (!batch) return failure('invalid_import', 400)
    const workspaceId = await ensureCloudWorkspace(account.client, account.subject)
    try {
      const receipt = await writeCloudBatch(admin, cipher, workspaceId, account.subject, batch)
      return NextResponse.json(receipt, { headers })
    } catch (error) {
      const message = (error as { message?: unknown }).message
      if (message === 'import_workspace_not_found') return failure('workspace_not_found', 404)
      if (message === 'import_payload_changed' || message === 'import_parent_missing' || message === 'import_batch_out_of_order') return failure(message, 409)
      if (message === 'invalid_import') return failure(message, 400)
      throw error
    }
  } catch {
    return failure('import_unavailable', 503)
  }
}
