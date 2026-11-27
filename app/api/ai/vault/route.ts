import { type NextRequest, NextResponse } from 'next/server'
import { accountContext } from '@/lib/auth/server'
import { createServerAdmin } from '@/lib/auth/admin'
import { siteOrigin } from '@/lib/auth/config'
import { readBoundedBody } from '@/lib/server/read-body'
import { encryptedVaultRevision, providerVaultLimit, validProviderEnvelope, vaultRevisionPattern } from '@/lib/ai/vault-sync'

const headers = { 'Cache-Control': 'private, no-store' }
const error = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers })

async function vaultAccount(request: NextRequest) {
  const account = await accountContext()
  if (!account || account.subject !== request.headers.get('x-lekhan-account')) return null
  return account.subject
}

export async function GET(request: NextRequest) {
  try {
    const subject = await vaultAccount(request)
    if (!subject) return error(401, 'sign_in_required')
    const admin = createServerAdmin()
    if (!admin) return error(503, 'vault_unavailable')
    const result = await admin.from('profiles').select('encrypted_ai_keys').eq('id', subject).maybeSingle()
    if (result.error || !result.data) return error(503, 'vault_unavailable')
    const envelope = result.data.encrypted_ai_keys
    if (envelope === null) return NextResponse.json({ vault: null }, { headers })
    if (!validProviderEnvelope(envelope)) return error(503, 'vault_unavailable')
    return NextResponse.json({ vault: { envelope, revision: await encryptedVaultRevision(envelope) } }, { headers })
  } catch {
    return error(503, 'vault_unavailable')
  }
}

export async function PUT(request: NextRequest) {
  if (request.headers.get('origin') !== (siteOrigin() ?? request.nextUrl.origin)) return error(403, 'invalid_origin')
  if (request.headers.get('content-type') !== 'application/json') return error(400, 'invalid_envelope')
  try {
    const subject = await vaultAccount(request)
    if (!subject) return error(401, 'sign_in_required')
    const admin = createServerAdmin()
    if (!admin) return error(503, 'vault_unavailable')
    const body = await readBoundedBody(request, providerVaultLimit + 256)
    if (!body) return error(400, 'invalid_envelope')
    let payload
    try { payload = JSON.parse(body.toString()) } catch { return error(400, 'invalid_envelope') }
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length !== 2 || !validProviderEnvelope(payload.envelope) ||
      (payload.previous !== null && (typeof payload.previous !== 'string' || !vaultRevisionPattern.test(payload.previous)))) {
      return error(400, 'invalid_envelope')
    }
    const result = await admin.rpc('rebuild_save_provider_vault', {
      target_profile: subject, previous_revision: payload.previous, ciphertext: payload.envelope,
    })
    if (result.error) return error(503, 'vault_unavailable')
    if (result.data === 'conflict') return error(409, 'vault_changed')
    if (result.data !== 'saved') return error(503, 'vault_unavailable')
    return NextResponse.json({ revision: await encryptedVaultRevision(payload.envelope) }, { headers })
  } catch {
    return error(503, 'vault_unavailable')
  }
}
