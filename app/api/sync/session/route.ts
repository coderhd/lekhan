import { type NextRequest, NextResponse } from 'next/server'
import { accountContext } from '@/lib/auth/server'
import { pageAccess, uuidPattern } from '@/lib/cloud/graph'
import { createSyncAdmin, relayedPageAccess } from '@/lib/sync/authority'
import { syncUrl } from '@/lib/sync/config'
import { getTicketSecret, issueSyncTicket } from '@/lib/sync/ticket'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest) {
  const pageId = request.nextUrl.searchParams.get('pageId')
  if (!pageId || !uuidPattern.test(pageId)) return NextResponse.json({ error: 'invalid_page' }, { status: 400, headers })
  const account = await accountContext()
  if (!account) return NextResponse.json({ error: 'sign_in_required' }, { status: 401, headers })
  const endpoint = syncUrl()
  const secret = getTicketSecret()
  const admin = createSyncAdmin()
  if (!endpoint || !secret || !admin) return NextResponse.json({ error: 'sync_unavailable' }, { status: 503, headers })

  try {
    const access = await pageAccess(account.client, pageId, account.subject)
    if (!access?.privateAccess) return NextResponse.json({ error: 'page_not_found' }, { status: 404, headers })
    const relay = await relayedPageAccess(admin, { pageId, subject: account.subject, role: access.role }, true)
    if (!relay) return NextResponse.json({ error: 'sync_access_denied' }, { status: 403, headers })
    const role = relay === 'read' ? 'viewer' : access.role
    const ticket = issueSyncTicket(secret, { pageId, subject: account.subject, role })
    return NextResponse.json({ ticket, endpoint, role, writable: relay === 'write' }, { headers })
  } catch {
    return NextResponse.json({ error: 'sync_unavailable' }, { status: 503, headers })
  }
}
