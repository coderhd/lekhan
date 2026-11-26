import { type NextRequest, NextResponse } from 'next/server'
import { accountContext } from '@/lib/auth/server'
import { findCloudPages, visibleCloudSearchCopies } from '@/lib/cloud/search'
import { uuidPattern } from '@/lib/cloud/graph'

const headers = { 'Cache-Control': 'private, no-store' }
const maxCopies = 15

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? ''
  if (query.length > 160) return NextResponse.json({ error: 'invalid_query' }, { status: 400, headers })
  const cache = request.nextUrl.searchParams.get('copies') ?? ''
  if (cache.length > maxCopies * 37 - 1) return NextResponse.json({ error: 'invalid_copies' }, { status: 400, headers })
  const copyIds = cache ? [...new Set(cache.split(','))] : []
  if (copyIds.length > maxCopies || copyIds.some(id => !uuidPattern.test(id))) {
    return NextResponse.json({ error: 'invalid_copies' }, { status: 400, headers })
  }
  const account = await accountContext()
  if (!account) return NextResponse.json({ error: 'sign_in_required' }, { status: 401, headers })
  try {
    const [pages, copies] = await Promise.all([
      findCloudPages(account.client, account.subject, query),
      copyIds.length ? visibleCloudSearchCopies(account.client, account.subject, copyIds) : undefined,
    ])
    return NextResponse.json({ pages, copies }, { headers })
  } catch {
    return NextResponse.json({ error: 'search_unavailable' }, { status: 503, headers })
  }
}
