import { type NextRequest, NextResponse } from 'next/server'
import { accountContext } from '@/lib/auth/server'
import { pageAccess, uuidPattern } from '@/lib/cloud/graph'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest) {
  const pageId = request.nextUrl.searchParams.get('pageId')
  const target = request.nextUrl.searchParams.get('target')?.trim()
  if (!pageId || !uuidPattern.test(pageId) || !target || target.length > 2048) return NextResponse.json({ id: null }, { status: 400, headers })
  const account = await accountContext()
  if (!account) return NextResponse.json({ id: null }, { status: 401, headers })
  try {
    const source = await pageAccess(account.client, pageId, account.subject)
    if (!source?.privateAccess) return NextResponse.json({ id: null }, { status: 404, headers })
    const { data, error } = await account.client.from('page_links').select('to_page_id')
      .eq('from_page_id', pageId).eq('to_title', target).maybeSingle()
    if (error) throw error
    const resolved = data?.to_page_id && await pageAccess(account.client, data.to_page_id, account.subject)
    return NextResponse.json({ id: resolved?.privateAccess ? resolved.page.id : null }, { headers })
  } catch {
    return NextResponse.json({ id: null }, { status: 503, headers })
  }
}
