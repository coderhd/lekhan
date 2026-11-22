import { after, type NextRequest, NextResponse } from 'next/server'
import { siteOrigin } from '@/lib/auth/config'
import { createServerAdmin } from '@/lib/auth/admin'
import { readBoundedBody } from '@/lib/server/read-body'
import { drainWaitlist } from '@/lib/waitlist/brevo'
import { confirmationToken } from '@/lib/waitlist/input'

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }

export async function GET(request: NextRequest) {
  // Existing confirmation URLs arrive here. A mail scanner opening that URL never confirms a signup.
  const target = new URL('/early/confirm', siteOrigin() ?? request.nextUrl.origin)
  const token = request.nextUrl.searchParams.get('token') ?? ''
  if (confirmationToken.test(token)) target.searchParams.set('token', token)
  return NextResponse.redirect(target, { status: 303, headers })
}

export async function POST(request: NextRequest) {
  const origin = siteOrigin() ?? request.nextUrl.origin
  function finish(result: string) {
    return NextResponse.redirect(new URL('/early/confirm?result=' + result, origin), { status: 303, headers })
  }

  const suppliedOrigin = request.headers.get('origin')
  const sameOriginForm = suppliedOrigin === 'null' && request.headers.get('sec-fetch-site') === 'same-origin'
  if (suppliedOrigin && suppliedOrigin !== origin && !sameOriginForm) return new Response(null, { status: 403, headers })
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return finish('invalid')
  const body = await readBoundedBody(request, 512)
  const token = body ? new URLSearchParams(body.toString('utf8')).get('token') ?? '' : ''
  if (!confirmationToken.test(token)) return finish('invalid')
  const admin = createServerAdmin()
  if (!admin) return finish('unavailable')
  const result = await admin.rpc('rebuild_confirm_waitlist', { token })
  if (result.error) return finish('unavailable')
  if (result.data !== true) return finish('invalid')
  after(() => drainWaitlist(admin).catch(() => { console.error('[waitlist] delivery drain failed') }))
  return finish('confirmed')
}
