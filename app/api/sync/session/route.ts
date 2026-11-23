import { type NextRequest, NextResponse } from 'next/server'
import { accountContext } from '@/lib/auth/server'
import { createServerAdmin } from '@/lib/auth/admin'
import { pageAccess, uuidPattern } from '@/lib/cloud/graph'
import { relayedPageAuthority } from '@/lib/sync/authority'
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
  const admin = createServerAdmin()
  if (!endpoint || !secret || !admin) return NextResponse.json({ error: 'sync_unavailable' }, { status: 503, headers })

  try {
    const access = await pageAccess(account.client, pageId, account.subject)
    if (!access?.privateAccess) return NextResponse.json({ error: 'page_not_found' }, { status: 404, headers })
    const { access: relay, imagePolicy, preference } = await relayedPageAuthority(admin, { pageId, subject: account.subject, role: access.role }, true)
    if (preference === 'paused') return NextResponse.json({ preference, imagePolicy }, { headers })
    if (relay === 'limit') return NextResponse.json({ error: 'collaborator_limit' }, { status: 403, headers })
    if (!relay) return NextResponse.json({ error: 'sync_access_denied' }, { status: 403, headers })
    const role = relay === 'read' ? 'viewer' : access.role
    const ticket = issueSyncTicket(secret, { pageId, subject: account.subject, role })
    return NextResponse.json({ ticket, endpoint, role, imagePolicy, preference, writable: relay === 'write',
      planRestricted: relay === 'read' && access.role !== 'viewer' }, { headers })
  } catch {
    return NextResponse.json({ error: 'sync_unavailable' }, { status: 503, headers })
  }
}
