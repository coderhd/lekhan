import { createHash, timingSafeEqual } from 'node:crypto'
import { createServerAdmin } from '@/lib/auth/admin'
import { reconcileBilling } from '@/lib/billing/reconciliation'

export const maxDuration = 300

const headers = { 'Cache-Control': 'private, no-store' }
const hash = (value: string) => createHash('sha256').update(value).digest()

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  const authorization = request.headers.get('authorization')
  if (!secret || !authorization || !timingSafeEqual(hash(authorization), hash('Bearer ' + secret))) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers })
  }

  const admin = createServerAdmin()
  if (!admin) return Response.json({ error: 'billing_unavailable' }, { status: 503, headers })
  try {
    const result = await reconcileBilling(admin)
    const attention = result.failures || result.unlocated || result.deferred
    return Response.json(result, { status: attention ? 503 : 200, headers })
  } catch {
    return Response.json({ error: 'billing_reconciliation_unavailable' }, { status: 503, headers })
  }
}
