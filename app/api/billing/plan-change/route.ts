import { readOffer } from '@/lib/billing/catalog'
import { changeRazorpayPlan, readPlanChanges } from '@/lib/billing/plan-changes'
import { BillingError, billingAccount } from '@/lib/billing/workspace'
import { readBoundedBody } from '@/lib/server/read-body'

const headers = { 'Cache-Control': 'private, no-store' }

function response(data: object, status = 200) {
  return Response.json(data, { status, headers })
}

function failure(error: unknown) {
  if (error instanceof BillingError) return response({ error: error.code }, error.status)
  return response({ error: 'billing_unavailable' }, 503)
}

export async function GET() {
  try {
    return response(await readPlanChanges(await billingAccount()))
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request) {
  try {
    const owner = await billingAccount()
    if (request.headers.get('origin') !== owner.origin) return response({ error: 'invalid_origin' }, 403)
    if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
      return response({ error: 'invalid_request' }, 415)
    }
    let data: Record<string, unknown>
    try {
      const raw = await readBoundedBody(request, 2048)
      data = raw && JSON.parse(raw.toString())
      if (!data || typeof data !== 'object' || Array.isArray(data)) return response({ error: 'invalid_request' }, 400)
    } catch {
      return response({ error: 'invalid_request' }, 400)
    }

    if (data.action === 'remove' && typeof data.key === 'string' && /^[a-f\d]{64}$/.test(data.key)) {
      await changeRazorpayPlan(owner, { action: 'remove', key: data.key })
    } else if (data.action === 'schedule') {
      const offer = readOffer(data)
      if (!offer || offer.currency !== 'INR') return response({ error: 'invalid_offer' }, 400)
      await changeRazorpayPlan(owner, { action: 'schedule', offer })
    } else {
      return response({ error: 'invalid_request' }, 400)
    }

    return response(await readPlanChanges(owner))
  } catch (error) {
    return failure(error)
  }
}
