import { createHash, randomBytes } from 'node:crypto'
import { after, type NextRequest, NextResponse } from 'next/server'
import { createServerAdmin } from '@/lib/auth/admin'
import { siteOrigin } from '@/lib/auth/config'
import { readBoundedBody } from '@/lib/server/read-body'
import { drainWaitlist } from '@/lib/waitlist/brevo'
import { FOUNDING_CAP, waitlistInput, WAITLIST_RECEIPT } from '@/lib/waitlist/input'
import { receiptSecret, waitlistReceipt } from '@/lib/waitlist/receipt'

const noStore = { 'Cache-Control': 'private, no-store' }
const windowMs = 10 * 60 * 1000
const recent = new Map<string, { until: number; count: number }>()

function rateLimited(request: NextRequest) {
  const ip = (request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for'))?.split(',')[0]?.trim()
  if (!ip) return false
  const key = createHash('sha256').update(ip.slice(0, 96)).digest('base64url')
  const now = Date.now()
  const previous = recent.get(key)
  if (previous && now < previous.until) return ++previous.count > 12
  if (recent.size >= 2048) {
    for (const [id, record] of recent) if (record.until <= now) recent.delete(id)
    if (recent.size >= 2048) recent.delete(recent.keys().next().value!)
  }
  recent.set(key, { until: now + windowMs, count: 1 })
  return false
}

export async function POST(request: NextRequest) {
  const origin = siteOrigin() ?? request.nextUrl.origin
  const suppliedOrigin = request.headers.get('origin')
  const format = request.headers.get('content-type')?.split(';')[0]
  const form = format === 'application/x-www-form-urlencoded'
  function failure(error: string, status: number) {
    if (form) {
      const target = new URL('/early', origin)
      target.searchParams.set('error', error)
      for (const field of ['ref', 'utm_source']) {
        const value = request.nextUrl.searchParams.get(field)
        if (value) target.searchParams.set(field, value.slice(0, 100))
      }
      return NextResponse.redirect(target, { status: 303, headers: noStore })
    }
    return NextResponse.json({ error }, { status, headers: noStore })
  }

  if (suppliedOrigin && suppliedOrigin !== origin) return NextResponse.json({ error: 'origin_rejected' }, { status: 403, headers: noStore })
  if (!form && format !== 'application/json') return failure('invalid', 415)
  if (rateLimited(request)) return failure('too_many', 429)
  const admin = createServerAdmin()
  const receiptKey = receiptSecret()
  if (!admin || !receiptKey) return failure('unavailable', 503)

  let input
  try {
    const bytes = await readBoundedBody(request, 8192)
    if (!bytes) return failure('invalid', 413)
    const raw = form ? Object.fromEntries(new URLSearchParams(bytes.toString('utf8'))) : JSON.parse(bytes.toString('utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return failure('invalid', 400)
    input = waitlistInput({ ref: request.nextUrl.searchParams.get('ref'), utm_source: request.nextUrl.searchParams.get('utm_source'), ...raw })
  } catch { return failure('invalid', 400) }
  if (!input) return failure('invalid', 400)

  const { data, error } = await admin.rpc('rebuild_join_waitlist', {
    address: input.email, referrer: input.referredBy, campaign: input.source, purpose: input.purpose, token: randomBytes(24).toString('hex'),
  })
  if (error || !Number.isSafeInteger(data?.position) || data.position < 1) return failure('unavailable', 503)
  const created = data.created === true
  after(() => drainWaitlist(admin).catch(() => { console.error('[waitlist] delivery drain failed') }))
  const response = form
    ? NextResponse.redirect(new URL('/early?joined=1', origin), { status: 303, headers: noStore })
    : NextResponse.json({ position: data.position, alreadyJoined: !created, foundingFull: data.position > FOUNDING_CAP }, { headers: noStore })
  response.cookies.set(WAITLIST_RECEIPT, waitlistReceipt(receiptKey, data.position, created), {
    path: '/early', httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', maxAge: 600,
  })
  return response
}
