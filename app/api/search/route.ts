import { type NextRequest, NextResponse } from 'next/server'
import { accountContext } from '@/lib/auth/server'
import { findCloudPages } from '@/lib/cloud/search'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? ''
  if (query.length > 160) return NextResponse.json({ error: 'invalid_query' }, { status: 400, headers })
  const account = await accountContext()
  if (!account) return NextResponse.json({ error: 'sign_in_required' }, { status: 401, headers })
  try {
    const pages = await findCloudPages(account.client, account.subject, query)
    return NextResponse.json({ pages }, { headers })
  } catch {
    return NextResponse.json({ error: 'search_unavailable' }, { status: 503, headers })
  }
}
