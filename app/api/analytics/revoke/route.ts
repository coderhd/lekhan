import { billingMeasurementToken } from '@/lib/analytics-settings'
import { createServerAdmin } from '@/lib/auth/admin'
import { siteOrigin } from '@/lib/auth/config'
import { revokeCheckoutMeasurement } from '@/lib/billing/measurement'
import { readBoundedBody } from '@/lib/server/read-body'

const headers = { 'Cache-Control': 'private, no-store' }

export async function POST(request: Request) {
  const origin = siteOrigin()
  if (!origin || request.headers.get('origin') !== origin) return new Response(null, { status: 403, headers })
  if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
    return new Response(null, { status: 415, headers })
  }
  let token: unknown
  try {
    const raw = await readBoundedBody(request, 128)
    token = raw && JSON.parse(raw.toString('utf8'))?.token
  } catch {
    return new Response(null, { status: 400, headers })
  }
  if (typeof token !== 'string' || !billingMeasurementToken.test(token)) return new Response(null, { status: 400, headers })

  try {
    const admin = createServerAdmin()
    if (!admin) return new Response(null, { status: 503, headers })
    await revokeCheckoutMeasurement(admin, token)
    return new Response(null, { status: 204, headers })
  } catch {
    return new Response(null, { status: 503, headers })
  }
}
