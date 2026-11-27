import { type NextRequest, NextResponse } from 'next/server'
import { createServerAdmin } from '@/lib/auth/admin'
import { accountContext } from '@/lib/auth/server'
import { workspaceEntitlementOrFree } from '@/lib/billing/entitlements'
import { FREE_ATTACHMENT_BYTES, PAID_ATTACHMENT_BYTES, type CloudAttachment } from '@/lib/cloud/attachments'
import { pageAccess, uuidPattern } from '@/lib/cloud/graph'

const headers = { 'Cache-Control': 'private, no-store' }
const limit = 50

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers })
}

export async function GET(request: NextRequest) {
  const pageId = request.nextUrl.searchParams.get('pageId')
  const after = request.nextUrl.searchParams.get('after')
  if (!pageId || !uuidPattern.test(pageId) || (after && !uuidPattern.test(after))) return error('invalid_page', 400)
  try {
    const account = await accountContext()
    if (!account) return error('sign_in_required', 401)
    const access = await pageAccess(account.client, pageId, account.subject)
    if (!access?.privateAccess) return error('page_not_found', 404)
    const admin = createServerAdmin()
    if (!admin) return error('attachments_unavailable', 503)
    let query = admin.from('rebuild_cloud_attachments').select('id,filename,byte_count')
      .eq('page_id', access.page.id).eq('state', 'ready')
    if (after) query = query.gt('id', after)
    const [list, plan] = await Promise.all([
      query.order('id').limit(limit + 1).returns<CloudAttachment[]>(), workspaceEntitlementOrFree(access.page.workspace_id, admin),
    ])
    if (list.error) throw list.error
    const files = list.data.slice(0, limit)
    return NextResponse.json({ files, after: list.data.length > limit ? files.at(-1)?.id : null, canRemove: access.role === 'owner',
      writable: access.role !== 'viewer' && !plan?.relayReadOnly,
      maxBytes: plan && plan.tier !== 'free' ? PAID_ATTACHMENT_BYTES : FREE_ATTACHMENT_BYTES }, { headers })
  } catch {
    return error('attachments_unavailable', 503)
  }
}

export async function DELETE(request: NextRequest) {
  const pageId = request.nextUrl.searchParams.get('pageId')
  const id = request.nextUrl.searchParams.get('id')
  if (!pageId || !id || !uuidPattern.test(pageId) || !uuidPattern.test(id)) return error('invalid_file', 400)
  try {
    const account = await accountContext()
    if (!account) return error('sign_in_required', 401)
    const admin = createServerAdmin()
    if (!admin) return error('attachments_unavailable', 503)
    const result = await admin.rpc('rebuild_remove_attachment', { target_page: pageId, actor: account.subject, attachment: id })
    if (result.error) throw result.error
    if (!result.data) return error('attachment_not_found', 404)
    return new Response(null, { status: 204, headers })
  } catch {
    return error('attachments_unavailable', 503)
  }
}
