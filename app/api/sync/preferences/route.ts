import { type NextRequest, NextResponse } from 'next/server'
import { accountContext } from '@/lib/auth/server'
import { pageAccess, uuidPattern } from '@/lib/cloud/graph'
import { readBoundedBody } from '@/lib/server/read-body'
import { syncUrl } from '@/lib/sync/config'
import { pageSyncPreference } from '@/lib/sync/preferences'
import { getTicketSecret, issueSyncTicket } from '@/lib/sync/ticket'

const headers = { 'Cache-Control': 'private, no-store' }

export async function POST(request: NextRequest) {
  const reject = (status: number, error: string) => NextResponse.json({ error }, { status, headers })
  const pageId = request.nextUrl.searchParams.get('pageId')
  if (!pageId || !uuidPattern.test(pageId) || request.headers.get('content-type') !== 'application/json') return reject(400, 'invalid_request')
  try {
    const account = await accountContext()
    if (!account) return reject(401, 'sign_in_required')
    const access = await pageAccess(account.client, pageId, account.subject)
    if (access?.role !== 'owner') return reject(404, 'page_not_found')
    const endpoint = syncUrl()
    const secret = getTicketSecret()
    if (!endpoint || !secret) return reject(503, 'sync_unavailable')
    const payload = await readBoundedBody(request, 1024)
    if (!payload) return reject(400, 'invalid_request')
    let enabled: unknown
    try { enabled = JSON.parse(payload.toString())?.enabled } catch { return reject(400, 'invalid_request') }
    if (typeof enabled !== 'boolean') return reject(400, 'invalid_request')
    const relay = new URL(endpoint)
    relay.protocol = relay.protocol === 'wss:' ? 'https:' : 'http:'
    relay.pathname = `/page-sync/${access.page.id}/${enabled ? 'resume' : 'pause'}`
    const response = await fetch(relay, { method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: 'Bearer ' + issueSyncTicket(secret, { pageId: access.page.id, subject: account.subject, role: 'owner' }) } })
    const result = await response.json()
    if (response.ok && pageSyncPreference(result.preference)) return NextResponse.json({ preference: result.preference }, { headers })
    if (response.status === 409) return reject(409, 'sync_required')
    if (response.status === 403) return reject(403, 'sync_denied')
    return reject(503, 'sync_unavailable')
  } catch {
    return reject(503, 'sync_unavailable')
  }
}
