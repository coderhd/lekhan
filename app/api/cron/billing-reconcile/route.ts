import { createServerAdmin } from '@/lib/auth/admin'
import { reconcileBilling } from '@/lib/billing/reconciliation'
import { flushBillingMeasurement } from '@/lib/billing/measurement'
import { authorizedCron } from '@/lib/server/cron'

export const maxDuration = 300

const headers = { 'Cache-Control': 'private, no-store' }
export async function GET(request: Request) {
  if (!authorizedCron(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers })
  }

  const admin = createServerAdmin()
  if (!admin) return Response.json({ error: 'billing_unavailable' }, { status: 503, headers })
  try {
    const result = await reconcileBilling(admin)
    const measurement = await flushBillingMeasurement(admin, true).catch(() => ({ failures: 1 }))
    const attention = result.failures || result.unlocated || result.deferred
    return Response.json({ ...result, measurement }, { status: attention ? 503 : 200, headers })
  } catch {
    return Response.json({ error: 'billing_reconciliation_unavailable' }, { status: 503, headers })
  }
}
